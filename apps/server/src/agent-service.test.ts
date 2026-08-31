import { mkdtemp, realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentService,
  PLAYGROUND_WORKSPACE_PROOF_PROMPT,
} from "./agent-service.js";
import { loadConfig } from "./config.js";
import { RunCancelledError, RunExecutionError } from "./errors.js";
import { JsonStore } from "./store.js";
import type { AgentRunner, RunnerRequest, RunnerResult } from "./types.js";
import { WorkspaceManager } from "./workspace.js";

class FakeRunner implements AgentRunner {
  async run(request: RunnerRequest): Promise<RunnerResult> {
    request.onTrace?.({
      dedupeKey: "codex.turn_started",
      type: "codex.turn_started",
      source: "codex",
      status: "running",
      summary: "Codex turn started.",
    });
    request.onTrace?.({
      dedupeKey: "codex.usage_reported",
      type: "codex.usage_reported",
      source: "codex",
      status: "info",
      summary: "Codex reported model usage.",
      metadata: { usage: { inputTokens: 12, outputTokens: 5 } },
    });
    return {
      output: "Completed: " + request.prompt,
      threadId: request.threadId ?? "fake-thread",
      usage: { inputTokens: 12, outputTokens: 5 },
    };
  }
  async cancel(): Promise<boolean> {
    return false;
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function makeService(
  runner: AgentRunner = new FakeRunner(),
  arkConfigured = true,
): Promise<AgentService> {
  const root = await mkdtemp(path.join(tmpdir(), "launchpad-test-"));
  temporaryDirectories.push(root);
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    APP_DATA_DIR: path.join(root, "data"),
    AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
    CODEX_HOME: path.join(root, "codex"),
  };
  if (arkConfigured) {
    environment.ARK_API_KEY = "test-key";
    environment.ARK_MODEL = "ep-test";
  }
  const config = loadConfig(environment);
  const service = new AgentService(
    config,
    new JsonStore(path.join(root, "data", "db.json")),
    new WorkspaceManager(path.join(root, "workspaces")),
    runner,
  );
  await service.initialize();
  return service;
}

describe("Agent lifecycle", () => {
  it("creates, updates, stops, starts and deletes an Agent", async () => {
    const service = await makeService();
    const agent = await service.createAgent({ name: "Builder" });
    expect(service.listAgents()).toHaveLength(1);
    expect((await service.updateAgent(agent.id, { description: "Builds apps" })).description)
      .toBe("Builds apps");
    expect((await service.stopAgent(agent.id)).status).toBe("stopped");
    expect((await service.startAgent(agent.id)).status).toBe("ready");
    await service.deleteAgent(agent.id);
    expect(service.listAgents()).toHaveLength(0);
  });

  it("persists a playground conversation", async () => {
    const service = await makeService();
    const agent = await service.createAgent({ name: "Coder" });
    const { run } = await service.sendMessage(agent.id, "write hello world");
    await expect.poll(() => service.getRun(run.id).status).toBe("completed");
    const messages = service.getMessages(agent.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.content).toContain("write hello world");
    expect(service.getAgent(agent.id).codexThreadId).toBe("fake-thread");
    expect(service.getTrace(run.id).events.map((event) => event.type)).toEqual([
      "run.queued",
      "run.started",
      "runtime.started",
      "codex.turn_started",
      "codex.usage_reported",
      "runtime.completed",
      "run.completed",
    ]);
  });

  it("runs the fixed workspace proof from the Playground without Ark", async () => {
    let captured: RunnerRequest | null = null;
    const service = await makeService(
      {
        run: async (request) => {
          captured = request;
          return {
            output: "Created and verified recovery-proof.txt through the local Runtime proof.",
            threadId: "fixture-thread",
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        },
        cancel: async () => false,
        isAvailable: async () => true,
      },
      false,
    );
    const agent = await service.createAgent({ name: "Offline proof" });
    const { run } = await service.sendMessage(
      agent.id,
      PLAYGROUND_WORKSPACE_PROOF_PROMPT,
      "workspace_proof",
    );
    await expect.poll(() => service.getRun(run.id).status).toBe("completed");

    expect(service.getRun(run.id)).toMatchObject({
      prompt: PLAYGROUND_WORKSPACE_PROOF_PROMPT,
      executionMode: "demo_runtime_success",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(captured).toMatchObject({
      prompt: PLAYGROUND_WORKSPACE_PROOF_PROMPT,
      executionMode: "demo_runtime_success",
    });
    expect(service.getMessages(agent.id).map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(service.getMessages(agent.id)[0]?.content).toBe(PLAYGROUND_WORKSPACE_PROOF_PROMPT);
    expect(service.getAgent(agent.id).codexThreadId).toBeNull();

    await expect(
      service.sendMessage(agent.id, "an arbitrary task", "workspace_proof"),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("records and redacts a controlled Runtime failure without creating a chat message", async () => {
    const service = await makeService({
      run: async (request) => {
        request.onTrace?.({
          dedupeKey: "codex.turn_failed",
          type: "codex.turn_failed",
          source: "codex",
          status: "failed",
          summary:
            "Injected failure. Authorization: Bearer techjam-demo-canary-not-a-secret",
        });
        throw new RunExecutionError(
          "nonzero_exit",
          "Runtime exited with code 17: Authorization: Bearer techjam-demo-canary-not-a-secret",
          17,
        );
      },
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Failure proof" });
    const { run } = await service.startDemoRun(agent.id, "runtime_nonzero");
    await expect.poll(() => service.getRun(run.id).status).toBe("failed");

    expect(service.getMessages(agent.id)).toEqual([]);
    expect(service.getRun(run.id)).toMatchObject({
      failureCode: "nonzero_exit",
      executionMode: "demo_runtime_failure",
    });
    const trace = service.getTrace(run.id);
    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain("techjam-demo-canary-not-a-secret");
    expect(serialized).toContain("[REDACTED]");
    expect(trace.events.at(-2)).toMatchObject({
      type: "runtime.failed",
      metadata: { failureCode: "nonzero_exit", exitCode: 17 },
    });
    expect(trace.events.at(-1)?.type).toBe("run.failed");
  });

  it("creates exactly one immutable workspace-only retry for a controlled failure", async () => {
    const requests: RunnerRequest[] = [];
    const service = await makeService({
      run: async (request) => {
        requests.push(request);
        if (request.executionMode === "demo_runtime_failure") {
          request.onTrace?.({
            dedupeKey: "codex.turn_failed",
            type: "codex.turn_failed",
            source: "codex",
            status: "failed",
            summary: "Controlled failure",
          });
          throw new RunExecutionError("nonzero_exit", "Controlled failure", 17);
        }
        request.onTrace?.({
          dedupeKey: "codex.turn_completed",
          type: "codex.turn_completed",
          source: "codex",
          status: "succeeded",
          summary: "Credential-free recovery completed.",
        });
        return {
          output: "Recovered from the persisted workspace",
          threadId: "fixture-thread-must-not-replace-agent-thread",
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Retry proof" });
    const { run: failed } = await service.startDemoRun(agent.id, "runtime_nonzero");
    await expect.poll(() => service.getRun(failed.id).status).toBe("failed");
    const immutableSource = service.getRun(failed.id);
    const retryKey = "33333333-3333-4333-8333-333333333333";

    const first = await service.retryRun(failed.id, retryKey);
    const duplicate = await service.retryRun(failed.id, retryKey);
    expect(duplicate.run.id).toBe(first.run.id);
    await expect(
      service.retryRun(failed.id, "44444444-4444-4444-8444-444444444444"),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect.poll(() => service.getRun(first.run.id).status).toBe("completed");

    expect(service.getRun(first.run.id)).toMatchObject({
      retryOfRunId: failed.id,
      rootRunId: failed.id,
      attemptNumber: 2,
      recoveryMode: "workspace_only",
      executionMode: "demo_runtime_success",
      threadIdAtStart: null,
    });
    expect(service.getRun(failed.id)).toEqual(immutableSource);
    expect(service.getRuns(agent.id).filter((run) => run.retryOfRunId === failed.id)).toHaveLength(1);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.workspacePath).toBe(requests[1]?.workspacePath);
    expect(requests[1]?.threadId).toBeNull();
    expect(service.getTrace(failed.id).events.at(-1)?.type).toBe("retry.requested");
    expect(service.getTrace(first.run.id).events.slice(0, 2).map((event) => event.type)).toEqual([
      "run.queued",
      "retry.created",
    ]);
    expect(service.getMessages(agent.id).map((message) => message.role)).toEqual([
      "assistant",
    ]);
    expect(service.getAgent(agent.id).codexThreadId).toBeNull();
  });

  it("rejects retry while the Agent is busy", async () => {
    let finishBusy!: (result: RunnerResult) => void;
    let holdSuccess = true;
    const pending = new Promise<RunnerResult>((resolve) => {
      finishBusy = resolve;
    });
    const service = await makeService({
      run: async (request) => {
        if (request.executionMode === "demo_runtime_failure") {
          throw new RunExecutionError("nonzero_exit", "Controlled failure", 17);
        }
        if (holdSuccess) return pending;
        return { output: "done", threadId: null, usage: null };
      },
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Busy retry" });
    const { run: failed } = await service.startDemoRun(agent.id, "runtime_nonzero");
    await expect.poll(() => service.getRun(failed.id).status).toBe("failed");
    const { run: busyRun } = await service.startDemoRun(agent.id, "runtime_success");
    await expect.poll(() => service.getRun(busyRun.id).status).toBe("running");

    await expect(
      service.retryRun(failed.id, "55555555-5555-4555-8555-555555555555"),
    ).rejects.toMatchObject({ statusCode: 409 });

    holdSuccess = false;
    finishBusy({ output: "busy proof completed", threadId: null, usage: null });
    await expect.poll(() => service.getRun(busyRun.id).status).toBe("completed");
  });

  it("normalizes an interrupted Run after restart with truthful trace evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-restart-test-"));
    temporaryDirectories.push(root);
    const config = loadConfig({
      NODE_ENV: "test",
      APP_DATA_DIR: path.join(root, "data"),
      AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
      CODEX_HOME: path.join(root, "codex"),
      ARK_API_KEY: "test-key",
      ARK_MODEL: "ep-test",
    });
    const databasePath = path.join(root, "data", "db.json");
    const firstStore = new JsonStore(databasePath);
    const first = new AgentService(
      config,
      firstStore,
      new WorkspaceManager(path.join(root, "workspaces")),
      new FakeRunner(),
    );
    await first.initialize();
    const agent = await first.createAgent({ name: "Interrupted" });
    const createdAt = new Date().toISOString();
    await firstStore.mutate((database) => {
      const storedAgent = database.agents.find((item) => item.id === agent.id);
      if (storedAgent) {
        storedAgent.status = "busy";
        storedAgent.workspacePath = path.join(root, "untrusted-stored-path");
      }
      database.runs.push({
        id: "run-interrupted",
        agentId: agent.id,
        status: "running",
        prompt: "long task",
        output: null,
        error: null,
        usage: null,
        failureCode: null,
        threadIdAtStart: null,
        retryOfRunId: null,
        rootRunId: "run-interrupted",
        attemptNumber: 1,
        recoveryMode: "none",
        retryRequestKey: null,
        recoveryInstruction: null,
        executionMode: "codex",
        startedAt: createdAt,
        completedAt: null,
        createdAt,
      });
    });

    const restarted = new AgentService(
      config,
      new JsonStore(databasePath),
      new WorkspaceManager(path.join(root, "workspaces")),
      new FakeRunner(),
    );
    await restarted.initialize();
    expect(restarted.getRun("run-interrupted")).toMatchObject({
      status: "cancelled",
      failureCode: "server_restart",
    });
    expect(restarted.getAgent(agent.id).status).toBe("ready");
    expect(restarted.getAgent(agent.id).workspacePath).toBe(
      await realpath(path.join(root, "workspaces", agent.id)),
    );
    expect(restarted.getTrace("run-interrupted").events.at(-1)).toMatchObject({
      type: "run.interrupted",
      metadata: { failureCode: "server_restart" },
    });
  });

  it.each([
    ["timeout", "Runtime timed out after 1000 ms"],
    ["output_limit", "Runtime output exceeded its configured limit"],
    ["spawn_error", "Runtime failed to start"],
  ] as const)("preserves the typed %s failure boundary", async (failureCode, message) => {
    const service = await makeService({
      run: async () => {
        throw new RunExecutionError(failureCode, message);
      },
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Typed failure" });
    const { run } = await service.sendMessage(agent.id, "exercise failure handling");
    await expect.poll(() => service.getRun(run.id).status).toBe("failed");
    expect(service.getRun(run.id).failureCode).toBe(failureCode);
    expect(service.getTrace(run.id).events.at(-2)).toMatchObject({
      type: "runtime.failed",
      metadata: { failureCode },
    });
  });

  it("records cancellation distinctly and leaves the Agent controllable", async () => {
    let rejectRun!: (error: Error) => void;
    const pending = new Promise<RunnerResult>((_resolve, reject) => {
      rejectRun = reject;
    });
    const service = await makeService({
      run: async () => pending,
      cancel: async () => {
        rejectRun(new RunCancelledError());
        return true;
      },
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Cancellable" });
    const { run } = await service.sendMessage(agent.id, "wait for cancellation");
    await expect.poll(() => service.getRun(run.id).status).toBe("running");
    await service.stopAgent(agent.id);

    expect(service.getRun(run.id)).toMatchObject({
      status: "cancelled",
      failureCode: "cancelled",
    });
    expect(service.getAgent(agent.id).status).toBe("stopped");
    expect(service.getTrace(run.id).events.at(-1)?.type).toBe("run.cancelled");
  });

  it("atomically accepts only one concurrent run per Agent", async () => {
    let finish!: (result: RunnerResult) => void;
    const pending = new Promise<RunnerResult>((resolve) => {
      finish = resolve;
    });
    const runner: AgentRunner = {
      run: () => pending,
      cancel: async () => false,
      isAvailable: async () => true,
    };
    const service = await makeService(runner);
    const agent = await service.createAgent({ name: "Concurrent" });
    const attempts = await Promise.allSettled([
      service.sendMessage(agent.id, "first"),
      service.sendMessage(agent.id, "second"),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({ reason: { statusCode: 409 } });
    expect(service.getMessages(agent.id)).toHaveLength(1);

    finish({ output: "done", threadId: "thread", usage: null });
    const accepted = attempts.find((attempt) => attempt.status === "fulfilled");
    if (accepted?.status === "fulfilled") {
      await expect.poll(() => service.getRun(accepted.value.run.id).status).toBe("completed");
    }
  });

  it("does not let start reset a busy Agent and admit a second run", async () => {
    let finish!: (result: RunnerResult) => void;
    const pending = new Promise<RunnerResult>((resolve) => {
      finish = resolve;
    });
    const service = await makeService({
      run: () => pending,
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Busy" });
    const { run } = await service.sendMessage(agent.id, "first");

    await expect(service.startAgent(agent.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.sendMessage(agent.id, "second")).rejects.toMatchObject({
      statusCode: 409,
    });

    finish({ output: "done", threadId: "thread", usage: null });
    await expect.poll(() => service.getRun(run.id).status).toBe("completed");
  });
});
