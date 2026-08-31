import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import { isArkConfigured } from "./config.js";
import { HttpError, RunCancelledError, RunExecutionError } from "./errors.js";
import { redactText } from "./redaction.js";
import { JsonStore } from "./store.js";
import {
  appendTraceEvent,
  RunTraceRecorder,
  traceEventsForRun,
} from "./trace.js";
import type {
  Agent,
  AgentRun,
  AgentRunner,
  CreateAgentInput,
  Message,
  RunnerExecutionMode,
  TraceEvent,
  UpdateAgentInput,
} from "./types.js";
import { WorkspaceManager } from "./workspace.js";

const now = () => new Date().toISOString();
export const PLAYGROUND_WORKSPACE_PROOF_PROMPT =
  "Create recovery-proof.txt containing 'Agent Black Box recovery succeeded', confirm it exists, and summarize the result.";
type DemoFixture = "runtime_nonzero" | "runtime_success";
type PlaygroundExecutionMode = "codex" | "workspace_proof";

interface CreateRunOptions {
  executionMode: RunnerExecutionMode;
  recordUserMessage: boolean;
  retryOfRunId?: string | null;
  rootRunId?: string;
  attemptNumber?: number;
  recoveryInstruction?: string | null;
  retryRequestKey?: string | null;
}

export class AgentService {
  private readonly activeExecutions = new Map<string, Promise<void>>();
  private readonly cancellationRequests = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
    private readonly workspaces: WorkspaceManager,
    private readonly runner: AgentRunner,
  ) {}

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.workspaces.initialize();
    const normalizedWorkspacePaths = new Map<string, string>();
    for (const agent of this.store.snapshot().agents) {
      const expected = this.workspaces.workspacePath(agent.id);
      normalizedWorkspacePaths.set(
        agent.id,
        await this.workspaces.assertManagedWorkspace({
          id: agent.id,
          workspacePath: expected,
        }),
      );
    }
    await this.store.mutate((database) => {
      for (const run of database.runs) {
        if (run.status === "queued" || run.status === "running") {
          const interruptedAt = now();
          run.status = "cancelled";
          run.error = "Server restarted while this run was active";
          run.failureCode = "server_restart";
          run.completedAt = interruptedAt;
          appendTraceEvent(database, run.agentId, run.id, {
            dedupeKey: "run.interrupted",
            type: "run.interrupted",
            source: "control_plane",
            status: "cancelled",
            timestamp: interruptedAt,
            summary: "Server restarted while this Run was active.",
            metadata: { failureCode: "server_restart" },
          });
        }
      }
      for (const agent of database.agents) {
        agent.workspacePath =
          normalizedWorkspacePaths.get(agent.id) ?? this.workspaces.workspacePath(agent.id);
        if (agent.status === "busy") {
          agent.status = "ready";
          agent.updatedAt = now();
        }
      }
    });
  }

  listAgents(): Agent[] {
    return this.store
      .snapshot()
      .agents.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getAgent(id: string): Agent {
    const agent = this.store.snapshot().agents.find((item) => item.id === id);
    if (!agent) {
      throw new HttpError(404, "Agent not found");
    }
    return agent;
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const timestamp = now();
    const id = randomUUID();
    const agent: Agent = {
      id,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      instructions: input.instructions?.trim() ?? "",
      status: "ready",
      workspacePath: this.workspaces.workspacePath(id),
      codexThreadId: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.workspaces.create(agent);
    await this.store.mutate((database) => database.agents.push(agent));
    return agent;
  }

  async updateAgent(id: string, input: UpdateAgentInput): Promise<Agent> {
    const current = this.getAgent(id);
    if (current.status === "busy") {
      throw new HttpError(409, "Stop the active run before editing this Agent");
    }
    const updated = await this.store.mutate((database) => {
      const agent = database.agents.find((item) => item.id === id);
      if (!agent) {
        throw new HttpError(404, "Agent not found");
      }
      if (agent.status === "busy") {
        throw new HttpError(409, "Stop the active run before editing this Agent");
      }
      if (input.name !== undefined) agent.name = input.name.trim();
      if (input.description !== undefined) agent.description = input.description.trim();
      if (input.instructions !== undefined) agent.instructions = input.instructions.trim();
      agent.lastError = null;
      agent.updatedAt = now();
      return structuredClone(agent);
    });
    await this.workspaces.writeInstructions(updated);
    return updated;
  }

  async deleteAgent(id: string): Promise<{ archivedWorkspace: string }> {
    const agent = this.getAgent(id);
    await this.cancelExecution(id);
    const archivedWorkspace = await this.workspaces.archive(agent);
    await this.store.mutate((database) => {
      database.agents = database.agents.filter((item) => item.id !== id);
      database.messages = database.messages.filter((item) => item.agentId !== id);
      database.runs = database.runs.filter((item) => item.agentId !== id);
      database.traceEvents = database.traceEvents.filter((item) => item.agentId !== id);
    });
    return { archivedWorkspace };
  }

  async startAgent(id: string): Promise<Agent> {
    return this.setStatus(id, "ready");
  }

  async stopAgent(id: string): Promise<Agent> {
    this.getAgent(id);
    await this.cancelExecution(id);
    return this.setStatus(id, "stopped");
  }

  getMessages(agentId: string): Message[] {
    this.getAgent(agentId);
    return this.store
      .snapshot()
      .messages.filter((message) => message.agentId === agentId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getRun(runId: string): AgentRun {
    const run = this.store.snapshot().runs.find((item) => item.id === runId);
    if (!run) {
      throw new HttpError(404, "Run not found");
    }
    return run;
  }

  getRuns(agentId: string): AgentRun[] {
    this.getAgent(agentId);
    return this.store
      .snapshot()
      .runs.filter((run) => run.agentId === agentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  getTrace(runId: string): {
    traceId: string;
    runId: string;
    agentId: string;
    events: TraceEvent[];
  } {
    const run = this.getRun(runId);
    const events = traceEventsForRun(this.store.snapshot(), runId);
    return { traceId: runId, runId, agentId: run.agentId, events };
  }

  async sendMessage(
    agentId: string,
    prompt: string,
    mode: PlaygroundExecutionMode = "codex",
  ): Promise<{ run: AgentRun; message: Message }> {
    if (mode === "codex" && !isArkConfigured(this.config)) {
      throw new HttpError(
        503,
        "Ark is not configured. Set ARK_API_KEY and ARK_MODEL, then restart.",
      );
    }
    if (mode === "workspace_proof" && prompt !== PLAYGROUND_WORKSPACE_PROOF_PROMPT) {
      throw new HttpError(400, "The workspace proof accepts only its fixed, visible task");
    }
    const result = await this.createRun(agentId, prompt, {
      executionMode: mode === "workspace_proof" ? "demo_runtime_success" : "codex",
      recordUserMessage: true,
    });
    if (!result.message) throw new Error("User message was not created");
    return { run: result.run, message: result.message };
  }

  async startDemoRun(agentId: string, fixture: DemoFixture): Promise<{ run: AgentRun }> {
    const result = await this.createRun(agentId, PLAYGROUND_WORKSPACE_PROOF_PROMPT, {
      executionMode:
        fixture === "runtime_success" ? "demo_runtime_success" : "demo_runtime_failure",
      recordUserMessage: false,
    });
    return { run: result.run };
  }

  private async createRun(
    agentId: string,
    prompt: string,
    options: CreateRunOptions,
  ): Promise<{ run: AgentRun; message: Message | null }> {
    const timestamp = now();
    const runId = randomUUID();
    const run: AgentRun = {
      id: runId,
      agentId,
      status: "queued",
      prompt,
      output: null,
      error: null,
      usage: null,
      failureCode: null,
      threadIdAtStart: null,
      retryOfRunId: options.retryOfRunId ?? null,
      rootRunId: options.rootRunId ?? runId,
      attemptNumber: options.attemptNumber ?? 1,
      recoveryMode: "none",
      retryRequestKey: options.retryRequestKey ?? null,
      recoveryInstruction: options.recoveryInstruction ?? null,
      executionMode: options.executionMode,
      startedAt: null,
      completedAt: null,
      createdAt: timestamp,
    };
    const message: Message | null = options.recordUserMessage
      ? {
          id: randomUUID(),
          agentId,
          runId,
          role: "user",
          content: prompt,
          createdAt: timestamp,
        }
      : null;
    const agentAtStart = await this.store.mutate((database) => {
      const storedAgent = database.agents.find((item) => item.id === agentId);
      if (!storedAgent) {
        throw new HttpError(404, "Agent not found");
      }
      if (storedAgent.status === "stopped") {
        throw new HttpError(409, "Start the Agent before sending a message");
      }
      if (storedAgent.status === "busy") {
        throw new HttpError(409, "This Agent is already running");
      }
      run.threadIdAtStart = storedAgent.codexThreadId;
      database.runs.push(run);
      if (message) database.messages.push(message);
      appendTraceEvent(database, agentId, runId, {
        dedupeKey: "run.queued",
        type: "run.queued",
        source: "control_plane",
        status: "queued",
        timestamp,
        summary:
          options.executionMode === "demo_runtime_failure"
            ? "Controlled failure proof queued."
            : options.executionMode === "demo_runtime_success"
              ? options.recordUserMessage
                ? "Playground workspace proof queued."
                : "Credential-free success proof queued."
              : "Agent Run queued.",
        metadata: {
          provider: this.config.runtimeProvider,
          recoveryMode: run.recoveryMode,
        },
      });
      const snapshot = structuredClone(storedAgent);
      storedAgent.status = "busy";
      storedAgent.lastError = null;
      storedAgent.updatedAt = timestamp;
      return snapshot;
    });
    this.scheduleExecution(agentAtStart, run);
    return { run, message };
  }

  async retryRun(runId: string, idempotencyKey: string): Promise<{ run: AgentRun }> {
    const timestamp = now();
    const newRunId = randomUUID();
    const result = await this.store.mutate((database) => {
      const source = database.runs.find((item) => item.id === runId);
      if (!source) throw new HttpError(404, "Run not found");
      if (source.status !== "failed" && source.status !== "cancelled") {
        throw new HttpError(409, "Only failed or cancelled Runs can be retried");
      }
      const existing = database.runs.find((item) => item.retryOfRunId === source.id);
      if (existing) {
        if (existing.retryRequestKey === idempotencyKey) {
          return { run: structuredClone(existing), agentAtStart: null };
        }
        throw new HttpError(409, "A retry already exists for this Run");
      }
      const agent = database.agents.find((item) => item.id === source.agentId);
      if (!agent) throw new HttpError(404, "Agent not found");
      if (agent.status === "stopped") {
        throw new HttpError(409, "Start the Agent before retrying this Run");
      }
      if (agent.status === "busy") {
        throw new HttpError(409, "This Agent is already running");
      }

      const executionMode: RunnerExecutionMode =
        source.executionMode === "codex" ? "codex" : "demo_runtime_success";
      if (executionMode === "codex" && !isArkConfigured(this.config)) {
        throw new HttpError(
          503,
          "Ark is not configured. Set ARK_API_KEY and ARK_MODEL, then restart.",
        );
      }
      const canReuseThread =
        executionMode === "codex" && source.threadIdAtStart !== null;
      const retry: AgentRun = {
        id: newRunId,
        agentId: source.agentId,
        status: "queued",
        prompt: source.prompt,
        output: null,
        error: null,
        usage: null,
        failureCode: null,
        threadIdAtStart: canReuseThread ? source.threadIdAtStart : null,
        retryOfRunId: source.id,
        rootRunId: source.rootRunId,
        attemptNumber: source.attemptNumber + 1,
        recoveryMode: canReuseThread ? "thread_and_workspace" : "workspace_only",
        retryRequestKey: idempotencyKey,
        recoveryInstruction:
          "Recovery attempt: inspect the persisted workspace first, avoid repeating completed side effects, and finish the original task safely.",
        executionMode,
        startedAt: null,
        completedAt: null,
        createdAt: timestamp,
      };
      const agentAtStart = structuredClone(agent);
      database.runs.push(retry);
      agent.status = "busy";
      agent.lastError = null;
      agent.updatedAt = timestamp;
      appendTraceEvent(database, source.agentId, source.id, {
        dedupeKey: "retry.requested",
        type: "retry.requested",
        source: "recovery",
        status: "info",
        timestamp,
        summary: "A linked retry was requested.",
        metadata: { recoveryMode: retry.recoveryMode },
      });
      appendTraceEvent(database, retry.agentId, retry.id, {
        dedupeKey: "run.queued",
        type: "run.queued",
        source: "control_plane",
        status: "queued",
        timestamp,
        summary: "Linked retry queued.",
        metadata: { recoveryMode: retry.recoveryMode },
      });
      appendTraceEvent(database, retry.agentId, retry.id, {
        dedupeKey: "retry.created",
        type: "retry.created",
        source: "recovery",
        status: "queued",
        timestamp,
        summary: "A new immutable retry attempt was created.",
        metadata: { recoveryMode: retry.recoveryMode },
      });
      return { run: structuredClone(retry), agentAtStart };
    });

    if (result.agentAtStart) this.scheduleExecution(result.agentAtStart, result.run);
    return { run: result.run };
  }

  private scheduleExecution(agentAtStart: Agent, run: AgentRun): void {
    const execution = this.executeRun(agentAtStart, run);
    this.activeExecutions.set(agentAtStart.id, execution);
    void execution
      .finally(() => {
        if (this.activeExecutions.get(agentAtStart.id) === execution) {
          this.activeExecutions.delete(agentAtStart.id);
        }
      })
      .catch(() => undefined);
  }

  async systemInfo(): Promise<Record<string, unknown>> {
    return {
      arkConfigured: isArkConfigured(this.config),
      arkBaseUrl: this.config.arkBaseUrl,
      arkModel: this.config.arkModel || null,
      codexAvailable: await this.runner.isAvailable(),
      codexSandboxMode: this.config.codexSandboxMode,
      runtimeProvider: this.config.runtimeProvider,
      containerEngine:
        this.config.runtimeProvider === "container"
          ? this.config.containerEngine
          : null,
      runtime:
        this.config.runtimeProvider === "container"
          ? "Codex CLI in " + this.config.containerEngine + " Runtime"
          : "Codex CLI in application container",
    };
  }

  private async executeRun(agentAtStart: Agent, run: AgentRun): Promise<void> {
    const recorder = new RunTraceRecorder(this.store, agentAtStart.id, run.id);
    const startedAt = now();
    await this.store.mutate((database) => {
      const storedRun = database.runs.find((item) => item.id === run.id);
      if (storedRun) {
        storedRun.status = "running";
        storedRun.startedAt = startedAt;
        appendTraceEvent(database, agentAtStart.id, run.id, {
          dedupeKey: "run.started",
          type: "run.started",
          source: "control_plane",
          status: "running",
          timestamp: startedAt,
          summary: "Agent Run started.",
          metadata: { recoveryMode: storedRun.recoveryMode },
        });
        appendTraceEvent(database, agentAtStart.id, run.id, {
          dedupeKey: "runtime.started",
          type: "runtime.started",
          source: "runtime",
          status: "running",
          timestamp: startedAt,
          summary:
            run.executionMode === "demo_runtime_failure"
              ? "Controlled failure Runtime started."
              : run.executionMode === "demo_runtime_success"
                ? "Credential-free success Runtime started."
                : "Agent Runtime started.",
          metadata: { provider: this.config.runtimeProvider },
        });
      }
    });
    try {
      if (this.cancellationRequests.has(agentAtStart.id)) {
        throw new RunCancelledError();
      }
      const executionPrompt = run.recoveryInstruction
        ? run.recoveryInstruction + "\n\nOriginal task:\n" + run.prompt
        : run.prompt;
      const result = await this.runner.run({
        agentId: agentAtStart.id,
        workspacePath: agentAtStart.workspacePath,
        prompt: executionPrompt,
        threadId: run.threadIdAtStart,
        executionMode: run.executionMode,
        onTrace: (event) => recorder.enqueue(event),
      });
      await recorder.flush();
      const completedAt = now();
      const durationMs = Date.parse(completedAt) - Date.parse(startedAt);
      await this.store.mutate((database) => {
        const storedRun = database.runs.find((item) => item.id === run.id);
        const agent = database.agents.find((item) => item.id === agentAtStart.id);
        if (!storedRun || !agent) return;
        storedRun.status = "completed";
        storedRun.output = result.output;
        storedRun.usage = result.usage;
        storedRun.failureCode = null;
        storedRun.completedAt = completedAt;
        database.messages.push({
          id: randomUUID(),
          agentId: agent.id,
          runId: run.id,
          role: "assistant",
          content: result.output,
          createdAt: completedAt,
        });
        agent.status = "ready";
        if (run.executionMode === "codex") agent.codexThreadId = result.threadId;
        agent.lastError = null;
        agent.updatedAt = completedAt;
        appendTraceEvent(database, agent.id, run.id, {
          dedupeKey: "runtime.completed",
          type: "runtime.completed",
          source: "runtime",
          status: "succeeded",
          timestamp: completedAt,
          durationMs,
          summary: "Agent Runtime completed successfully.",
          metadata: { provider: this.config.runtimeProvider },
        });
        appendTraceEvent(database, agent.id, run.id, {
          dedupeKey: "run.completed",
          type: "run.completed",
          source: "control_plane",
          status: "succeeded",
          timestamp: completedAt,
          durationMs,
          summary: "Agent Run completed successfully.",
          ...(result.usage ? { metadata: { usage: result.usage } } : {}),
        });
      });
    } catch (error) {
      let effectiveError: unknown = error;
      try {
        await recorder.flush();
      } catch (traceError) {
        const detail = traceError instanceof Error ? traceError.message : String(traceError);
        effectiveError = new RunExecutionError(
          "trace_persistence",
          "Trace persistence failed: " + detail,
        );
      }
      const completedAt = now();
      const durationMs = Date.parse(completedAt) - Date.parse(startedAt);
      const cancelled = effectiveError instanceof RunCancelledError;
      const failureCode = cancelled
        ? "cancelled"
        : effectiveError instanceof RunExecutionError
          ? effectiveError.code
          : "unknown";
      const rawMessage =
        effectiveError instanceof Error ? effectiveError.message : String(effectiveError);
      const message = redactText(rawMessage, 1_000).text;
      await this.store.mutate((database) => {
        const storedRun = database.runs.find((item) => item.id === run.id);
        const agent = database.agents.find((item) => item.id === agentAtStart.id);
        if (storedRun) {
          storedRun.status = cancelled ? "cancelled" : "failed";
          storedRun.error = message;
          storedRun.failureCode = failureCode;
          storedRun.completedAt = completedAt;
        }
        if (agent) {
          if (agent.status !== "stopped") {
            agent.status = cancelled ? "ready" : "error";
          }
          agent.lastError = cancelled ? null : message;
          agent.updatedAt = completedAt;
        }
        appendTraceEvent(database, agentAtStart.id, run.id, {
          dedupeKey: "runtime.failed",
          type: "runtime.failed",
          source: "runtime",
          status: cancelled ? "cancelled" : "failed",
          timestamp: completedAt,
          durationMs,
          summary: cancelled ? "Agent Runtime was cancelled." : message,
          metadata: {
            provider: this.config.runtimeProvider,
            failureCode,
            ...(effectiveError instanceof RunExecutionError && effectiveError.exitCode !== undefined
              ? { exitCode: effectiveError.exitCode }
              : {}),
          },
        });
        appendTraceEvent(database, agentAtStart.id, run.id, {
          dedupeKey: cancelled ? "run.cancelled" : "run.failed",
          type: cancelled ? "run.cancelled" : "run.failed",
          source: "control_plane",
          status: cancelled ? "cancelled" : "failed",
          timestamp: completedAt,
          durationMs,
          summary: cancelled ? "Agent Run was cancelled." : "Agent Run failed.",
          metadata: { failureCode },
        });
      });
    }
  }

  private async setStatus(id: string, status: Agent["status"]): Promise<Agent> {
    return this.store.mutate((database) => {
      const agent = database.agents.find((item) => item.id === id);
      if (!agent) {
        throw new HttpError(404, "Agent not found");
      }
      if (status === "ready" && agent.status === "busy") {
        throw new HttpError(409, "Stop the active run before starting this Agent");
      }
      agent.status = status;
      if (status === "ready") agent.lastError = null;
      agent.updatedAt = now();
      return structuredClone(agent);
    });
  }

  private async cancelExecution(agentId: string): Promise<void> {
    this.cancellationRequests.add(agentId);
    try {
      await this.runner.cancel(agentId);
      const execution = this.activeExecutions.get(agentId);
      if (execution) {
        await execution;
      }
    } finally {
      this.cancellationRequests.delete(agentId);
    }
  }
}
