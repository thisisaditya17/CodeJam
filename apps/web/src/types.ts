export type AgentStatus = "ready" | "busy" | "stopped" | "error";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
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
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: RunStatus;
  prompt: string;
  output: string | null;
  error: string | null;
  usage: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
  } | null;
  failureCode: RunFailureCode | null;
  threadIdAtStart: string | null;
  retryOfRunId: string | null;
  rootRunId: string;
  attemptNumber: number;
  recoveryMode: RecoveryMode;
  retryRequestKey: string | null;
  recoveryInstruction: string | null;
  executionMode: "codex" | "demo_runtime_failure";
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface TraceMetadata {
  itemId?: string;
  threadId?: string;
  provider?: "local-process" | "container";
  commandPreview?: string;
  exitCode?: number;
  fileChanges?: Array<{ path: string; kind: "add" | "delete" | "update" }>;
  usage?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
  };
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
  type: string;
  source: "control_plane" | "runtime" | "codex" | "recovery";
  status: "info" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
  timestamp: string;
  durationMs?: number;
  summary: string;
  metadata?: TraceMetadata;
}

export interface RunTrace {
  traceId: string;
  runId: string;
  agentId: string;
  events: TraceEvent[];
}

export interface SystemInfo {
  arkConfigured: boolean;
  arkBaseUrl: string;
  arkModel: string | null;
  codexAvailable: boolean;
  codexSandboxMode: string;
  runtimeProvider: "local-process" | "container";
  containerEngine: string | null;
  runtime: string;
}
