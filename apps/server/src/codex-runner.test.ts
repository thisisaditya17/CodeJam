import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import {
  buildCodexArgs,
  localExecutionCommand,
  parseCodexEventLine,
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
