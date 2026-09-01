import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import {
  buildCodexArgs,
  CodexRunner,
  createParsedEvents,
  localExecutionCommand,
  parseCodexEventLine,
  parseRunnerEventLine,
  resolveRunCodexHome,
} from "./codex-runner.js";
import type { TraceDraft } from "./types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Codex runner protocol", () => {
  it("isolates new Codex state by Agent and preserves legacy thread lookup", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-codex-home-test-"));
    temporaryDirectories.push(root);
    const config = loadConfig({
      NODE_ENV: "test",
      APP_DATA_DIR: path.join(root, "data"),
      AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
      CODEX_HOME: path.join(root, "codex-home"),
      ARK_MODEL: "ep-test",
    });

    const legacy = await resolveRunCodexHome(config, {
      agentId: "legacy-agent",
      threadId: "existing-thread",
    });
    expect(legacy).toBe(config.codexHome);

    const first = await resolveRunCodexHome(config, {
      agentId: "new-agent",
      threadId: null,
    });
    const outsideTarget = path.join(root, "must-not-be-overwritten");
    await writeFile(outsideTarget, "preserve me", "utf8");
    await rm(path.join(first, "config.toml"));
    await symlink(outsideTarget, path.join(first, "config.toml"));
    const continuation = await resolveRunCodexHome(config, {
      agentId: "new-agent",
      threadId: "new-thread",
    });
    const otherAgent = await resolveRunCodexHome(config, {
      agentId: "other-agent",
      threadId: null,
    });
    expect(first).toBe(continuation);
    expect(first).not.toBe(otherAgent);
    expect(path.dirname(first)).toBe(path.join(config.codexHome, "agents"));
    expect(await readFile(outsideTarget, "utf8")).toBe("preserve me");
    expect((await lstat(path.join(first, "config.toml"))).isSymbolicLink()).toBe(false);
  });

  it("builds a new-session invocation", () => {
    const args = buildCodexArgs(
      {
        agentId: "agent",
        workspacePath: "/tmp/workspace",
        prompt: "build a calculator",
        threadId: null,
        executionMode: "codex",
      },
      "workspace-write",
    );
    expect(args).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "-C",
      "/tmp/workspace",
      "build a calculator",
    ]);
  });

  it("resumes a stored Codex thread", () => {
    const args = buildCodexArgs(
      {
        agentId: "agent",
        workspacePath: "/tmp/workspace",
        prompt: "add tests",
        threadId: "thread-123",
        executionMode: "codex",
      },
      "workspace-write",
    );
    expect(args.slice(-3)).toEqual(["resume", "thread-123", "add tests"]);
  });

  it("extracts the session, final message and usage", () => {
    const parsed = {
      messages: [] as string[],
      threadId: null as string | null,
      usage: null as {
        inputTokens?: number;
        cachedInputTokens?: number;
        outputTokens?: number;
      } | null,
      errors: [] as string[],
    };
    parseCodexEventLine(
      JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
      parsed,
    );
    parseCodexEventLine(
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Done." },
      }),
      parsed,
    );
    parseCodexEventLine(
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 10, output_tokens: 4 },
      }),
      parsed,
    );
    expect(parsed.threadId).toBe("thread-123");
    expect(parsed.messages).toEqual(["Done."]);
    expect(parsed.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
  });

  it("maps safe command, file and turn evidence without output or reasoning", () => {
    const traces: TraceDraft[] = [];
    const parsed = {
      messages: [] as string[],
      threadId: null as string | null,
      usage: null,
      errors: [] as string[],
      onTrace: (trace: TraceDraft) => traces.push(trace),
      provider: "container" as const,
      itemStartedAt: new Map<string, number>(),
      turnStartedAt: null,
    };
    parseCodexEventLine(JSON.stringify({ type: "turn.started" }), parsed);
    parseCodexEventLine(
      JSON.stringify({
        type: "item.started",
        item: {
          id: "command-1",
          type: "command_execution",
          command: "npm test",
          aggregated_output: "",
          status: "in_progress",
        },
      }),
      parsed,
    );
    parseCodexEventLine(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "command-1",
          type: "command_execution",
          command: "npm test",
          aggregated_output: "API_KEY=must-not-be-captured",
          exit_code: 0,
          status: "completed",
        },
      }),
      parsed,
    );
    parseCodexEventLine(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "file-1",
          type: "file_change",
          changes: [{ path: "src/index.ts", kind: "update" }],
          status: "completed",
        },
      }),
      parsed,
    );
    parseCodexEventLine(
      JSON.stringify({
        type: "item.completed",
        item: { id: "reasoning-1", type: "reasoning", text: "private reasoning" },
      }),
      parsed,
    );
    parseCodexEventLine(
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 4 },
      }),
      parsed,
    );

    expect(traces.map((trace) => trace.type)).toEqual([
      "codex.turn_started",
      "codex.command_started",
      "codex.command_completed",
      "codex.file_changed",
      "codex.usage_reported",
      "codex.turn_completed",
    ]);
    expect(JSON.stringify(traces)).not.toContain("must-not-be-captured");
    expect(JSON.stringify(traces)).not.toContain("private reasoning");
  });

  it("uses a credential-free local executable for the controlled failure", () => {
    const config = loadConfig({ NODE_ENV: "test", ARK_API_KEY: "real-secret" });
    const command = localExecutionCommand(
      {
        agentId: "agent",
        workspacePath: "/tmp/workspace",
        prompt: "controlled failure",
        threadId: null,
        executionMode: "demo_runtime_failure",
      },
      config,
    );
    expect(command.bin).toBe(process.execPath);
    expect(command.args.at(-1)).toMatch(/demo-runtime-failure\.mjs$/);
    expect(command.args).not.toContain("real-secret");
  });

  it("derives controlled failure evidence from a real child process exit", () => {
    const fixturePath = fileURLToPath(
      new URL("../../../scripts/demo-runtime-failure.mjs", import.meta.url),
    );
    const result = spawnSync(process.execPath, [fixturePath], {
      encoding: "utf8",
      env: { NO_COLOR: "1" },
    });
    const events = result.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const operation = events.find(
      (event) => event.type === "runtime.operation.completed",
    )?.operation as Record<string, unknown> | undefined;

    expect(result.status).toBe(17);
    expect(operation).toMatchObject({ exit_code: 17, status: "failed" });
    expect(events.at(-1)).toMatchObject({
      type: "runtime.proof.failed",
      error: {
        message:
          "Injected Runtime failure. Authorization: Bearer techjam-demo-canary-not-a-secret",
      },
    });
    expect(result.stderr).toBe("");
  });

  it("maps controlled proof events to Runtime evidence rather than Codex evidence", () => {
    const traces: TraceDraft[] = [];
    const parsed = createParsedEvents(
      {
        agentId: "agent",
        workspacePath: "/tmp/workspace",
        prompt: "controlled failure",
        threadId: null,
        executionMode: "demo_runtime_failure",
        onTrace: (trace) => traces.push(trace),
      },
      "container",
    );
    parseRunnerEventLine(JSON.stringify({ type: "runtime.proof.started" }), parsed);
    parseRunnerEventLine(
      JSON.stringify({
        type: "runtime.operation.started",
        operation: { id: "check", command: "node check.mjs", status: "in_progress" },
      }),
      parsed,
    );
    parseRunnerEventLine(
      JSON.stringify({
        type: "runtime.operation.completed",
        operation: {
          id: "check",
          command: "node check.mjs",
          exit_code: 17,
          status: "failed",
        },
      }),
      parsed,
    );
    parseRunnerEventLine(
      JSON.stringify({
        type: "runtime.proof.failed",
        error: { message: "Injected Runtime failure" },
      }),
      parsed,
    );

    expect(traces.map((trace) => trace.type)).toEqual([
      "runtime.proof_started",
      "runtime.operation_started",
      "runtime.operation_completed",
      "runtime.proof_failed",
    ]);
    expect(traces.every((trace) => trace.source === "runtime")).toBe(true);
    expect(JSON.stringify(traces)).not.toContain("codex.");
  });

  it("selects the credential-free success executable", () => {
    const config = loadConfig({ NODE_ENV: "test", ARK_API_KEY: "real-secret" });
    const command = localExecutionCommand(
      {
        agentId: "agent",
        workspacePath: "/tmp/workspace",
        prompt: "workspace proof",
        threadId: null,
        executionMode: "demo_runtime_success",
      },
      config,
    );
    expect(command.bin).toBe(process.execPath);
    expect(command.args.at(-1)).toMatch(/demo-runtime-success\.mjs$/);
    expect(command.args).not.toContain("real-secret");
  });

  it("runs the credential-free workspace proof with Runtime-owned evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-proof-test-"));
    temporaryDirectories.push(root);
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const config = loadConfig({
      NODE_ENV: "test",
      APP_DATA_DIR: path.join(root, "data"),
      AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
      CODEX_HOME: path.join(root, "codex-home"),
    });
    const traces: TraceDraft[] = [];
    const result = await new CodexRunner(config).run({
      agentId: "proof-agent",
      workspacePath: workspace,
      prompt: "workspace proof",
      threadId: null,
      executionMode: "demo_runtime_success",
      onTrace: (trace) => traces.push(trace),
    });

    expect(result).toMatchObject({
      output: "Created and verified recovery-proof.txt through the credential-free Runtime proof.",
      threadId: null,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
    });
    expect(await readFile(path.join(workspace, "recovery-proof.txt"), "utf8")).toBe(
      "Agent Black Box recovery succeeded\n",
    );
    expect(traces.map((trace) => trace.type)).toEqual([
      "runtime.proof_started",
      "runtime.operation_started",
      "runtime.operation_completed",
      "runtime.file_changed",
      "runtime.metrics_reported",
      "runtime.proof_completed",
    ]);
    expect(traces.every((trace) => trace.source === "runtime")).toBe(true);
  });

  it("labels a controlled child-process failure as Runtime evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-failure-label-test-"));
    temporaryDirectories.push(root);
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const config = loadConfig({
      NODE_ENV: "test",
      APP_DATA_DIR: path.join(root, "data"),
      AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
      CODEX_HOME: path.join(root, "codex-home"),
    });
    const traces: TraceDraft[] = [];

    await expect(
      new CodexRunner(config).run({
        agentId: "failure-proof-agent",
        workspacePath: workspace,
        prompt: "controlled failure",
        threadId: null,
        executionMode: "demo_runtime_failure",
        onTrace: (trace) => traces.push(trace),
      }),
    ).rejects.toThrow("Controlled Runtime proof exited with code 17");
    expect(traces.every((trace) => trace.source === "runtime")).toBe(true);
    expect(JSON.stringify(traces)).not.toContain("codex.");
  });

  it("ignores malformed and unknown JSONL without creating trace evidence", () => {
    const traces: TraceDraft[] = [];
    const parsed = {
      messages: [] as string[],
      threadId: null as string | null,
      usage: null,
      errors: [] as string[],
      onTrace: (trace: TraceDraft) => traces.push(trace),
    };
    parseCodexEventLine("{not-json", parsed);
    parseCodexEventLine(JSON.stringify({ type: "future.event", raw: "must not persist" }), parsed);
    expect(traces).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });
});
