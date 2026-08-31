import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { AgentService } from "./agent-service.js";

const service = {
  listAgents: () => [],
  systemInfo: async () => ({}),
} as unknown as AgentService;

describe("HTTP boundary", () => {
  it("sets security and no-store headers on API responses", async () => {
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service);
    const response = await app.inject({ method: "GET", url: "/api/agents" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    await app.close();
  });

  it("does not disclose internal error or secret details", async () => {
    const failingService = {
      ...service,
      systemInfo: async () => {
        throw new Error("token: internal-canary-value at /private/server/path");
      },
    } as unknown as AgentService;
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), failingService);
    const response = await app.inject({ method: "GET", url: "/api/system" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Internal server error" });
    expect(response.body).not.toContain("internal-canary-value");
    expect(response.body).not.toContain("/private/server/path");
    await app.close();
  });

  it("omits absolute workspace paths from public Agent responses", async () => {
    const agentId = "22222222-2222-4222-8222-222222222222";
    const boundaryService = {
      ...service,
      listAgents: () => [
        {
          id: agentId,
          name: "Safe Agent",
          description: "",
          instructions: "",
          status: "ready",
          workspacePath: "/Users/private-name/workspaces/agent",
          codexThreadId: null,
          lastError: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } as unknown as AgentService;
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), boundaryService);
    const response = await app.inject({ method: "GET", url: "/api/agents" });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("workspacePath");
    expect(response.body).not.toContain("/Users/private-name");
    expect(response.json()).toMatchObject({ agents: [{ id: agentId, name: "Safe Agent" }] });
    await app.close();
  });

  it("rate-limits repeated Runtime mutation requests", async () => {
    const agentId = "22222222-2222-4222-8222-222222222222";
    const boundaryService = {
      ...service,
      startDemoRun: async (id: string) => ({ run: { id: "run-id", agentId: id } }),
    } as unknown as AgentService;
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), boundaryService);
    for (let index = 0; index < 10; index += 1) {
      const accepted = await app.inject({
        method: "POST",
        url: "/api/agents/" + agentId + "/demo-runs",
        payload: { fixture: "runtime_success" },
      });
      expect(accepted.statusCode).toBe(202);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/api/agents/" + agentId + "/demo-runs",
      payload: { fixture: "runtime_success" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "Too many requests" });
    await app.close();
  });

  it("protects API routes with the configured shared token", async () => {
    const app = await createApp(
      loadConfig({ NODE_ENV: "test", APP_AUTH_TOKEN: "a-strong-test-token" }),
      service,
    );
    const denied = await app.inject({ method: "GET", url: "/api/agents" });
    expect(denied.statusCode).toBe(401);

    const allowed = await app.inject({
      method: "GET",
      url: "/api/agents",
      headers: { authorization: "Bearer a-strong-test-token" },
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it("preserves Fastify client error status codes", async () => {
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service);
    const malformed = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: { "content-type": "application/json" },
      payload: "{not-json",
    });
    expect(malformed.statusCode).toBe(400);

    const oversized = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "x".repeat(1_100_000) }),
    });
    expect(oversized.statusCode).toBe(413);
    await app.close();
  });

  it("exposes validated trace and controlled-failure routes", async () => {
    const runId = "11111111-1111-4111-8111-111111111111";
    const agentId = "22222222-2222-4222-8222-222222222222";
    const messageRequests: Array<{ content: string; executionMode: string }> = [];
    const boundaryService = {
      ...service,
      getTrace: (id: string) => ({
        traceId: id,
        runId: id,
        agentId,
        events: [],
      }),
      startDemoRun: async (id: string) => ({ run: { id: runId, agentId: id } }),
      sendMessage: async (id: string, content: string, executionMode: string) => {
        messageRequests.push({ content, executionMode });
        return {
          run: { id: runId, agentId: id },
          message: { id: "message-id", agentId: id, content },
        };
      },
      retryRun: async () => ({ run: { id: runId, agentId } }),
    } as unknown as AgentService;
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), boundaryService);

    const trace = await app.inject({ method: "GET", url: "/api/runs/" + runId + "/trace" });
    expect(trace.statusCode).toBe(200);
    expect(trace.json()).toMatchObject({ traceId: runId, agentId });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/agents/" + agentId + "/demo-runs",
      payload: { fixture: "arbitrary-command" },
    });
    expect(invalid.statusCode).toBe(400);

    const accepted = await app.inject({
      method: "POST",
      url: "/api/agents/" + agentId + "/demo-runs",
      payload: { fixture: "runtime_nonzero" },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toMatchObject({ run: { id: runId, agentId } });

    const success = await app.inject({
      method: "POST",
      url: "/api/agents/" + agentId + "/demo-runs",
      payload: { fixture: "runtime_success" },
    });
    expect(success.statusCode).toBe(202);

    const playgroundProof = await app.inject({
      method: "POST",
      url: "/api/agents/" + agentId + "/messages",
      payload: { content: "fixed visible task", executionMode: "workspace_proof" },
    });
    expect(playgroundProof.statusCode).toBe(202);
    expect(messageRequests).toEqual([
      { content: "fixed visible task", executionMode: "workspace_proof" },
    ]);

    const invalidExecutionMode = await app.inject({
      method: "POST",
      url: "/api/agents/" + agentId + "/messages",
      payload: { content: "fixed visible task", executionMode: "arbitrary" },
    });
    expect(invalidExecutionMode.statusCode).toBe(400);

    const invalidRetry = await app.inject({
      method: "POST",
      url: "/api/runs/" + runId + "/retries",
      payload: { idempotencyKey: "not-a-uuid" },
    });
    expect(invalidRetry.statusCode).toBe(400);

    const retry = await app.inject({
      method: "POST",
      url: "/api/runs/" + runId + "/retries",
      payload: { idempotencyKey: "66666666-6666-4666-8666-666666666666" },
    });
    expect(retry.statusCode).toBe(202);
    await app.close();
  });
});
