import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { AgentService } from "./agent-service.js";

const service = {
  listAgents: () => [],
  systemInfo: async () => ({}),
} as unknown as AgentService;

describe("HTTP boundary", () => {
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
