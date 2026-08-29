export type AgentStatus = "ready" | "busy" | "stopped" | "error";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type MessageRole = "user" | "assistant";
export type RunFailureCode =
  | "runtime_unavailable"
  | "spawn_error"
  | "nonzero_exit"
  | "timeout"
  | "cancelled"
  | "output_limit"
  | "codex_error"
  | "no_agent_message"
  | "server_restart"
  | "trace_persistence"
  | "unknown";
export type RecoveryMode = "none" | "workspace_only" | "thread_and_workspace";
export type RunnerExecutionMode = "codex" | "demo_runtime_failure";
export type TraceSource = "control_plane" | "runtime" | "codex" | "recovery";
export type TraceStatus =
  | "info"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";
export type TraceEventType =
  | "run.queued"
  | "run.started"
  | "runtime.started"
  | "codex.thread_started"
  | "codex.turn_started"
  | "codex.command_started"
  | "codex.command_completed"
  | "codex.file_changed"
  | "codex.usage_reported"
  | "codex.error"
  | "codex.turn_completed"
  | "codex.turn_failed"
  | "runtime.completed"
  | "runtime.failed"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "run.interrupted"
  | "retry.requested"
  | "retry.created"
  | "trace.truncated";

export interface Agent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  status: AgentStatus;
  workspacePath: string;
  codexThreadId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  agentId: string;
  runId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export interface RunUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: RunStatus;
  prompt: string;
  output: string | null;
  error: string | null;
  usage: RunUsage | null;
  failureCode: RunFailureCode | null;
  threadIdAtStart: string | null;
  retryOfRunId: string | null;
  rootRunId: string;
  attemptNumber: number;
  recoveryMode: RecoveryMode;
  retryRequestKey: string | null;
  recoveryInstruction: string | null;
  executionMode: RunnerExecutionMode;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface TraceFileChange {
  path: string;
  kind: "add" | "delete" | "update";
}

export interface TraceMetadata {
  itemId?: string;
  threadId?: string;
  provider?: "local-process" | "container";
  commandPreview?: string;
  exitCode?: number;
  fileChanges?: TraceFileChange[];
  usage?: RunUsage;
  failureCode?: RunFailureCode;
  recoveryMode?: RecoveryMode;
  redactionCount?: number;
  metadataTruncated?: boolean;
}

export interface TraceEvent {
  id: string;
  schemaVersion: 1;
  traceId: string;
  agentId: string;
  runId: string;
  sequence: number;
  dedupeKey: string;
  type: TraceEventType;
  source: TraceSource;
  status: TraceStatus;
  timestamp: string;
  durationMs?: number;
  summary: string;
  metadata?: TraceMetadata;
}

export interface TraceDraft {
  dedupeKey: string;
  type: TraceEventType;
  source: TraceSource;
  status: TraceStatus;
  timestamp?: string;
  durationMs?: number;
  summary: string;
  metadata?: TraceMetadata;
}

export interface Database {
  version: 1;
  agents: Agent[];
  messages: Message[];
  runs: AgentRun[];
  traceEvents: TraceEvent[];
}

export interface CreateAgentInput {
  name: string;
  description?: string | undefined;
  instructions?: string | undefined;
}

export interface UpdateAgentInput {
  name?: string | undefined;
  description?: string | undefined;
  instructions?: string | undefined;
}

export interface RunnerResult {
  output: string;
  threadId: string | null;
  usage: RunUsage | null;
}

export interface RunnerRequest {
  agentId: string;
  workspacePath: string;
  prompt: string;
  threadId: string | null;
  executionMode: RunnerExecutionMode;
  onTrace?: ((event: TraceDraft) => void) | undefined;
}

export interface AgentRunner {
  run(request: RunnerRequest): Promise<RunnerResult>;
  cancel(agentId: string): Promise<boolean>;
  isAvailable(): Promise<boolean>;
}
