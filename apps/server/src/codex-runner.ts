import { execFile } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { AppConfig } from "./config.js";
import { RunCancelledError, RunExecutionError } from "./errors.js";
import type {
  AgentRunner,
  RunUsage,
  RunnerRequest,
  RunnerResult,
  TraceDraft,
  TraceFileChange,
  TraceMetadata,
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface ParsedEvents {
  messages: string[];
  threadId: string | null;
  usage: RunUsage | null;
  errors: string[];
  onTrace?: ((event: TraceDraft) => void) | undefined;
  provider?: "local-process" | "container" | undefined;
  itemStartedAt?: Map<string, number> | undefined;
  turnStartedAt?: number | null | undefined;
}

export function createParsedEvents(
  request: RunnerRequest,
  provider: "local-process" | "container",
): ParsedEvents {
  return {
    messages: [],
    threadId: request.threadId,
    usage: null,
    errors: [],
    onTrace: request.onTrace,
    provider,
    itemStartedAt: new Map<string, number>(),
    turnStartedAt: null,
  };
}

function emitTrace(parsed: ParsedEvents, draft: TraceDraft): void {
  parsed.onTrace?.(draft);
}

function providerMetadata(parsed: ParsedEvents): Pick<TraceMetadata, "provider"> {
  return parsed.provider === undefined ? {} : { provider: parsed.provider };
}

function itemStatus(value: unknown): "running" | "succeeded" | "failed" {
  if (value === "failed" || value === "declined") return "failed";
  if (value === "completed") return "succeeded";
  return "running";
}

function fileChanges(value: unknown): TraceFileChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const change = entry as Record<string, unknown>;
    if (
      typeof change.path !== "string" ||
      !["add", "delete", "update"].includes(String(change.kind))
    ) {
      return [];
    }
    return [{ path: change.path, kind: change.kind as TraceFileChange["kind"] }];
  });
}

export function buildCodexArgs(
  request: RunnerRequest,
  sandboxMode: AppConfig["codexSandboxMode"],
  workspacePath = request.workspacePath,
): string[] {
  const args = [
    "exec",
    "--json",
    "--sandbox",
    sandboxMode,
    "--skip-git-repo-check",
    "-C",
    workspacePath,
  ];
  if (request.threadId) {
    args.push("resume", request.threadId, request.prompt);
  } else {
    args.push(request.prompt);
  }
  return args;
}

export function parseCodexEventLine(line: string, parsed: ParsedEvents): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }

  if (event.type === "thread.started" && typeof event.thread_id === "string") {
    parsed.threadId = event.thread_id;
    emitTrace(parsed, {
      dedupeKey: "codex.thread_started:" + event.thread_id,
      type: "codex.thread_started",
      source: "codex",
      status: "running",
      summary: "Codex thread started.",
      metadata: { threadId: event.thread_id, ...providerMetadata(parsed) },
    });
  }

  if (event.type === "turn.started") {
    parsed.turnStartedAt = Date.now();
    emitTrace(parsed, {
      dedupeKey: "codex.turn_started",
      type: "codex.turn_started",
      source: "codex",
      status: "running",
      summary: "Codex turn started.",
      metadata: providerMetadata(parsed),
    });
  }

  if (event.type === "item.started" && event.item && typeof event.item === "object") {
    const item = event.item as Record<string, unknown>;
    if (
      typeof item.id === "string" &&
      item.type === "command_execution" &&
      typeof item.command === "string"
    ) {
      parsed.itemStartedAt ??= new Map<string, number>();
      parsed.itemStartedAt.set(item.id, Date.now());
      emitTrace(parsed, {
        dedupeKey: "codex.command_started:" + item.id,
        type: "codex.command_started",
        source: "codex",
        status: "running",
        summary: "Command execution started.",
        metadata: {
          itemId: item.id,
          commandPreview: item.command,
          ...providerMetadata(parsed),
        },
      });
    }
  }

  if (event.type === "item.completed" && event.item && typeof event.item === "object") {
    const item = event.item as Record<string, unknown>;
    if (item.type === "agent_message" && typeof item.text === "string") {
      parsed.messages.push(item.text);
    }
    if (
      typeof item.id === "string" &&
      item.type === "command_execution" &&
      typeof item.command === "string"
    ) {
      const startedAt = parsed.itemStartedAt?.get(item.id);
      emitTrace(parsed, {
        dedupeKey: "codex.command_completed:" + item.id,
        type: "codex.command_completed",
        source: "codex",
        status: itemStatus(item.status),
        summary:
          item.status === "failed"
            ? "Command execution failed."
            : item.status === "declined"
              ? "Command execution was declined."
              : "Command execution completed.",
        ...(startedAt !== undefined ? { durationMs: Date.now() - startedAt } : {}),
        metadata: {
          itemId: item.id,
          commandPreview: item.command,
          ...(typeof item.exit_code === "number" ? { exitCode: item.exit_code } : {}),
          ...providerMetadata(parsed),
        },
      });
    }
    if (typeof item.id === "string" && item.type === "file_change") {
      emitTrace(parsed, {
        dedupeKey: "codex.file_changed:" + item.id,
        type: "codex.file_changed",
        source: "codex",
        status: itemStatus(item.status),
        summary:
          item.status === "failed"
            ? "Workspace file changes failed."
            : "Workspace files changed.",
        metadata: {
          itemId: item.id,
          fileChanges: fileChanges(item.changes),
          ...providerMetadata(parsed),
        },
      });
    }
    if (typeof item.id === "string" && item.type === "error" && typeof item.message === "string") {
      parsed.errors.push(item.message);
      emitTrace(parsed, {
        dedupeKey: "codex.error:item:" + item.id,
        type: "codex.error",
        source: "codex",
        status: "failed",
        summary: item.message,
        metadata: { itemId: item.id, ...providerMetadata(parsed) },
      });
    }
  }

  if (event.type === "turn.completed" && event.usage && typeof event.usage === "object") {
    const usage = event.usage as Record<string, unknown>;
    parsed.usage = {
      ...(typeof usage.input_tokens === "number"
        ? { inputTokens: usage.input_tokens }
        : {}),
      ...(typeof usage.cached_input_tokens === "number"
        ? { cachedInputTokens: usage.cached_input_tokens }
        : {}),
      ...(typeof usage.output_tokens === "number"
        ? { outputTokens: usage.output_tokens }
        : {}),
    };
    emitTrace(parsed, {
      dedupeKey: "codex.usage_reported",
      type: "codex.usage_reported",
      source: "codex",
      status: "info",
      summary: "Codex reported model usage.",
      metadata: { usage: parsed.usage, ...providerMetadata(parsed) },
    });
    emitTrace(parsed, {
      dedupeKey: "codex.turn_completed",
      type: "codex.turn_completed",
      source: "codex",
      status: "succeeded",
      summary: "Codex turn completed.",
      ...(parsed.turnStartedAt != null ? { durationMs: Date.now() - parsed.turnStartedAt } : {}),
      metadata: providerMetadata(parsed),
    });
  }

  if (event.type === "turn.failed" && event.error && typeof event.error === "object") {
    const error = event.error as Record<string, unknown>;
    const message =
      typeof error.message === "string" ? error.message : "Codex turn failed without detail";
    parsed.errors.push(message);
    emitTrace(parsed, {
      dedupeKey: "codex.turn_failed",
      type: "codex.turn_failed",
      source: "codex",
      status: "failed",
      summary: message,
      ...(parsed.turnStartedAt != null ? { durationMs: Date.now() - parsed.turnStartedAt } : {}),
      metadata: providerMetadata(parsed),
    });
  }

  if (event.type === "error") {
    const message =
      typeof event.message === "string"
        ? event.message
        : typeof event.error === "string"
          ? event.error
          : "Codex reported an unknown error";
    parsed.errors.push(message);
    emitTrace(parsed, {
      dedupeKey: "codex.error:stream:" + parsed.errors.length,
      type: "codex.error",
      source: "codex",
      status: "failed",
      summary: message,
      metadata: providerMetadata(parsed),
    });
  }
}

export function localExecutionCommand(
  request: RunnerRequest,
  config: AppConfig,
): { bin: string; args: string[] } {
  if (request.executionMode === "demo_runtime_failure") {
    return {
      bin: process.execPath,
      args: [fileURLToPath(new URL("../../../scripts/demo-runtime-failure.mjs", import.meta.url))],
    };
  }
  return { bin: config.codexBin, args: buildCodexArgs(request, config.codexSandboxMode) };
}

export class CodexRunner implements AgentRunner {
  private readonly active = new Map<
    string,
    {
      child: ChildProcess;
      cancelled: boolean;
      timedOut: boolean;
      outputExceeded: boolean;
      settled: Promise<void>;
      forceKillTimer: NodeJS.Timeout | null;
    }
  >();

  constructor(private readonly config: AppConfig) {}

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.config.codexBin, ["--version"], {
        timeout: 5_000,
        env: this.childEnvironment(),
      });
      return true;
    } catch {
      return false;
    }
  }

  async cancel(agentId: string): Promise<boolean> {
    const active = this.active.get(agentId);
    if (!active) {
      return false;
    }
    active.cancelled = true;
    this.terminate(active);
    await active.settled;
    return true;
  }

  async run(request: RunnerRequest): Promise<RunnerResult> {
    if (this.active.has(request.agentId)) {
      throw new Error("Agent already has an active Codex process");
    }

    const command = localExecutionCommand(request, this.config);
    const child = spawn(command.bin, command.args, {
      cwd: request.workspacePath,
      env: this.childEnvironment(request.executionMode),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const settled = new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      child.once("error", () => resolve());
    });
    const active = {
      child,
      cancelled: false,
      timedOut: false,
      outputExceeded: false,
      settled,
      forceKillTimer: null as NodeJS.Timeout | null,
    };
    this.active.set(request.agentId, active);

    const parsed = createParsedEvents(request, "local-process");
    let stdout = "";
    let stderr = "";
    let totalBytes = 0;

    const consume = (chunk: Buffer, target: "stdout" | "stderr") => {
      totalBytes += chunk.byteLength;
      if (totalBytes > this.config.codexMaxOutputBytes) {
        active.outputExceeded = true;
        this.terminate(active);
        return;
      }
      if (target === "stdout") {
        stdout += chunk.toString("utf8");
        const lines = stdout.split(/\r?\n/);
        stdout = lines.pop() ?? "";
        for (const line of lines) {
          parseCodexEventLine(line, parsed);
        }
      } else {
        stderr += chunk.toString("utf8");
        if (stderr.length > 16_384) {
          stderr = stderr.slice(-16_384);
        }
      }
    };

    child.stdout.on("data", (chunk: Buffer) => consume(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => consume(chunk, "stderr"));

    const timeout = setTimeout(() => {
      active.timedOut = true;
      this.terminate(active);
    }, this.config.codexTimeoutMs);
    timeout.unref();

    try {
      let exitCode: number;
      try {
        exitCode = await new Promise<number>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code) => resolve(code ?? 1));
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new RunExecutionError("spawn_error", "Runtime failed to start: " + detail);
      }
      if (stdout.trim()) {
        parseCodexEventLine(stdout.trim(), parsed);
      }
      if (active.cancelled) {
        throw new RunCancelledError();
      }
      if (active.timedOut) {
        throw new RunExecutionError(
          "timeout",
          "Codex timed out after " + this.config.codexTimeoutMs + " ms",
        );
      }
      if (active.outputExceeded) {
        throw new RunExecutionError(
          "output_limit",
          "Codex output exceeded CODEX_MAX_OUTPUT_BYTES",
        );
      }
      if (exitCode !== 0) {
        const detail = parsed.errors.at(-1) ?? stderr.trim() ?? "No error detail";
        throw new RunExecutionError(
          "nonzero_exit",
          "Codex exited with code " + exitCode + ": " + detail,
          exitCode,
        );
      }
      const output = parsed.messages.at(-1)?.trim();
      if (!output) {
        const detail = parsed.errors.at(-1);
        throw new RunExecutionError(
          detail ? "codex_error" : "no_agent_message",
          detail ?? "Codex completed without an agent message",
        );
      }
      return {
        output,
        threadId: parsed.threadId,
        usage: parsed.usage,
      };
    } finally {
      clearTimeout(timeout);
      if (active.forceKillTimer) clearTimeout(active.forceKillTimer);
      this.active.delete(request.agentId);
    }
  }

  private terminate(active: {
    child: ChildProcess;
    forceKillTimer: NodeJS.Timeout | null;
  }): void {
    if (active.child.exitCode !== null || active.child.signalCode !== null) return;
    active.child.kill("SIGTERM");
    if (!active.forceKillTimer) {
      active.forceKillTimer = setTimeout(() => active.child.kill("SIGKILL"), 3_000);
      active.forceKillTimer.unref();
    }
  }

  private childEnvironment(
    executionMode: RunnerRequest["executionMode"] = "demo_runtime_failure",
  ): NodeJS.ProcessEnv {
    const inheritedNames = [
      "PATH",
      "HOME",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "NODE_EXTRA_CA_CERTS",
      "TERM",
    ] as const;
    const environment: NodeJS.ProcessEnv = {
      CODEX_HOME: this.config.codexHome,
      NO_COLOR: "1",
    };
    if (executionMode === "codex") environment.ARK_API_KEY = this.config.arkApiKey;
    for (const name of inheritedNames) {
      if (process.env[name] !== undefined) environment[name] = process.env[name];
    }
    return environment;
  }
}
