import { describe, expect, it } from "vitest";
import { appendTraceEvent, MAX_NORMAL_TRACE_EVENTS, sanitizeWorkspacePath } from "./trace.js";
import type { Database } from "./types.js";

const database = (): Database => ({
  version: 1,
  agents: [],
  messages: [],
  runs: [],
  traceEvents: [],
});

describe("trace persistence", () => {
  it("assigns deterministic sequence numbers and deduplicates", () => {
    const data = database();
    appendTraceEvent(data, "agent-1", "run-1", {
      dedupeKey: "run.queued",
      type: "run.queued",
      source: "control_plane",
      status: "queued",
      summary: "Run queued",
    });
    appendTraceEvent(data, "agent-1", "run-1", {
      dedupeKey: "run.queued",
      type: "run.queued",
      source: "control_plane",
      status: "queued",
      summary: "Duplicate",
    });
    appendTraceEvent(data, "agent-1", "run-1", {
      dedupeKey: "run.started",
      type: "run.started",
      source: "control_plane",
      status: "running",
      summary: "Run started",
    });
    expect(data.traceEvents.map((event) => event.sequence)).toEqual([1, 2]);
    expect(data.traceEvents.map((event) => event.summary)).toEqual([
      "Run queued",
      "Run started",
    ]);
  });

  it("redacts trace summaries and typed metadata", () => {
    const data = database();
    appendTraceEvent(data, "agent-1", "run-1", {
      dedupeKey: "codex.error:1",
      type: "codex.error",
      source: "codex",
      status: "failed",
      summary: "Authorization: Bearer techjam-demo-canary",
      metadata: { commandPreview: "API_KEY=techjam-demo-canary" },
    });
    const serialized = JSON.stringify(data.traceEvents);
    expect(serialized).not.toContain("techjam-demo-canary");
    expect(serialized).toContain("[REDACTED]");
    expect(data.traceEvents[0]?.metadata?.redactionCount).toBe(2);
  });

  it("caps normal events but reserves terminal evidence", () => {
    const data = database();
    for (let index = 0; index < MAX_NORMAL_TRACE_EVENTS + 20; index += 1) {
      appendTraceEvent(data, "agent-1", "run-1", {
        dedupeKey: "event-" + index,
        type: "codex.command_started",
        source: "codex",
        status: "running",
        summary: "command " + index,
      });
    }
    expect(data.traceEvents).toHaveLength(MAX_NORMAL_TRACE_EVENTS + 1);
    expect(data.traceEvents.at(-1)?.type).toBe("trace.truncated");

    appendTraceEvent(data, "agent-1", "run-1", {
      dedupeKey: "run.failed",
      type: "run.failed",
      source: "control_plane",
      status: "failed",
      summary: "Run failed",
    });
    expect(data.traceEvents.at(-1)?.type).toBe("run.failed");
  });

  it("keeps only safe workspace-relative paths", () => {
    expect(sanitizeWorkspacePath("src/index.ts")).toBe("src/index.ts");
    expect(sanitizeWorkspacePath("../secret.txt")).toBe("[OUTSIDE_WORKSPACE]");
    expect(sanitizeWorkspacePath("/etc/passwd")).toBe("[OUTSIDE_WORKSPACE]");
    expect(sanitizeWorkspacePath("C:\\Users\\person\\secret.txt")).toBe(
      "[OUTSIDE_WORKSPACE]",
    );
  });
});
