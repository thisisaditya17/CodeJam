import { randomUUID } from "node:crypto";
import path from "node:path";
import { redactText } from "./redaction.js";
import type { JsonStore } from "./store.js";
import type {
  Database,
  TraceDraft,
  TraceEvent,
  TraceFileChange,
  TraceMetadata,
} from "./types.js";

export const MAX_TRACE_EVENTS = 256;
export const MAX_NORMAL_TRACE_EVENTS = 248;
const MAX_METADATA_BYTES = 4_096;
const TERMINAL_TYPES = new Set<TraceDraft["type"]>([
  "runtime.completed",
  "runtime.failed",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.interrupted",
  "retry.requested",
  "retry.created",
]);

function sanitizeIdentifier(value: string, maximum = 160): string {
  return redactText(value, maximum).text;
}

export function sanitizeWorkspacePath(value: string): string {
  const portable = value.replaceAll("\\", "/");
  const normalized = path.posix.normalize(portable);
  if (
    path.posix.isAbsolute(normalized) ||
    /^[a-z]:\//i.test(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return "[OUTSIDE_WORKSPACE]";
  }
  return redactText(normalized, 256).text;
}

function sanitizeFileChanges(changes: TraceFileChange[]): {
  changes: TraceFileChange[];
  truncated: boolean;
  redactionCount: number;
} {
  let redactionCount = 0;
  const limited = changes.slice(0, 32).map((change) => {
    const redacted = redactText(sanitizeWorkspacePath(change.path), 256);
    redactionCount += redacted.redactionCount;
    return { path: redacted.text, kind: change.kind };
  });
  return { changes: limited, truncated: changes.length > limited.length, redactionCount };
}

function sanitizeMetadata(metadata: TraceMetadata | undefined): {
  metadata?: TraceMetadata;
  redactionCount: number;
} {
  if (!metadata) return { redactionCount: 0 };
  let redactionCount = 0;
  let metadataTruncated = metadata.metadataTruncated ?? false;
  const safe: TraceMetadata = {};

  if (metadata.itemId !== undefined) safe.itemId = sanitizeIdentifier(metadata.itemId);
  if (metadata.threadId !== undefined) safe.threadId = sanitizeIdentifier(metadata.threadId);
  if (metadata.provider !== undefined) safe.provider = metadata.provider;
  if (metadata.commandPreview !== undefined) {
    const result = redactText(metadata.commandPreview, 256);
    safe.commandPreview = result.text;
    redactionCount += result.redactionCount;
    metadataTruncated ||= result.truncated;
  }
  if (metadata.exitCode !== undefined && Number.isInteger(metadata.exitCode)) {
    safe.exitCode = metadata.exitCode;
  }
  if (metadata.fileChanges !== undefined) {
    const result = sanitizeFileChanges(metadata.fileChanges);
    safe.fileChanges = result.changes;
    redactionCount += result.redactionCount;
    metadataTruncated ||= result.truncated;
  }
  if (metadata.usage !== undefined) safe.usage = { ...metadata.usage };
  if (metadata.failureCode !== undefined) safe.failureCode = metadata.failureCode;
  if (metadata.recoveryMode !== undefined) safe.recoveryMode = metadata.recoveryMode;

  safe.redactionCount = (metadata.redactionCount ?? 0) + redactionCount;
  if (metadataTruncated) safe.metadataTruncated = true;

  if (Buffer.byteLength(JSON.stringify(safe), "utf8") > MAX_METADATA_BYTES) {
    delete safe.commandPreview;
    delete safe.fileChanges;
    safe.metadataTruncated = true;
  }
  return { metadata: safe, redactionCount };
}

function nextSequence(events: TraceEvent[]): number {
  return events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0) + 1;
}

function makeEvent(
  agentId: string,
  runId: string,
  sequence: number,
  draft: TraceDraft,
): TraceEvent {
  const summary = redactText(draft.summary, 512);
  const metadata = sanitizeMetadata(draft.metadata);
  const redactionCount = summary.redactionCount + metadata.redactionCount;
  const safeMetadata = metadata.metadata ?? {};
  if (redactionCount > 0) {
    safeMetadata.redactionCount = (safeMetadata.redactionCount ?? 0) + summary.redactionCount;
  }
  return {
    id: randomUUID(),
    schemaVersion: 1,
    traceId: runId,
    agentId,
    runId,
    sequence,
    dedupeKey: sanitizeIdentifier(draft.dedupeKey, 200),
    type: draft.type,
    source: draft.source,
    status: draft.status,
    timestamp: draft.timestamp ?? new Date().toISOString(),
    ...(draft.durationMs !== undefined && Number.isFinite(draft.durationMs)
      ? { durationMs: Math.max(0, Math.round(draft.durationMs)) }
      : {}),
    summary: summary.text,
    ...(Object.keys(safeMetadata).length > 0 ? { metadata: safeMetadata } : {}),
  };
}

export function appendTraceEvent(
  database: Database,
  agentId: string,
  runId: string,
  draft: TraceDraft,
): TraceEvent | null {
  const existing = database.traceEvents.filter((event) => event.runId === runId);
  if (existing.some((event) => event.dedupeKey === draft.dedupeKey)) return null;
  if (existing.length >= MAX_TRACE_EVENTS) return null;

  if (!TERMINAL_TYPES.has(draft.type) && existing.length >= MAX_NORMAL_TRACE_EVENTS) {
    if (!existing.some((event) => event.type === "trace.truncated")) {
      const truncated = makeEvent(agentId, runId, nextSequence(existing), {
        dedupeKey: "trace.truncated",
        type: "trace.truncated",
        source: "control_plane",
        status: "info",
        summary: "Additional non-terminal trace events were omitted to preserve bounded storage.",
        metadata: { metadataTruncated: true },
      });
      database.traceEvents.push(truncated);
      return truncated;
    }
    return null;
  }

  const event = makeEvent(agentId, runId, nextSequence(existing), draft);
  database.traceEvents.push(event);
  return event;
}

export function traceEventsForRun(database: Database, runId: string): TraceEvent[] {
  return database.traceEvents
    .filter((event) => event.runId === runId)
    .sort((left, right) => left.sequence - right.sequence);
}

export class RunTraceRecorder {
  private queue: Promise<void> = Promise.resolve();
  private firstError: unknown = null;

  constructor(
    private readonly store: JsonStore,
    private readonly agentId: string,
    private readonly runId: string,
  ) {}

  enqueue(draft: TraceDraft): void {
    this.queue = this.queue
      .then(async () => {
        await this.store.mutate((database) => {
          appendTraceEvent(database, this.agentId, this.runId, draft);
        });
      })
      .catch((error: unknown) => {
        if (this.firstError === null) this.firstError = error;
      });
  }

  async record(draft: TraceDraft): Promise<void> {
    this.enqueue(draft);
    await this.flush();
  }

  async flush(): Promise<void> {
    await this.queue;
    if (this.firstError !== null) throw this.firstError;
  }
}
