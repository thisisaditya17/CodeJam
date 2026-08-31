import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "./store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("JsonStore", () => {
  it("normalizes historical version-one data without trace fields", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-store-history-test-"));
    temporaryDirectories.push(root);
    const filePath = path.join(root, "db.json");
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        agents: [],
        messages: [],
        runs: [
          {
            id: "run-1",
            agentId: "agent-1",
            status: "failed",
            prompt: "test",
            output: null,
            error: "failed",
            usage: null,
            startedAt: null,
            completedAt: null,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );
    const store = new JsonStore(filePath);
    await store.initialize();
    const snapshot = store.snapshot();
    expect(snapshot.traceEvents).toEqual([]);
    expect(snapshot.runs[0]).toMatchObject({
      rootRunId: "run-1",
      attemptNumber: 1,
      failureCode: null,
      recoveryMode: "none",
      executionMode: "codex",
    });
  });

  it("does not publish a mutation in memory when persistence fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-store-test-"));
    temporaryDirectories.push(root);
    const originalPath = path.join(root, "db.json");
    const store = new JsonStore(originalPath);
    await store.initialize();

    const mutableStore = store as unknown as { filePath: string };
    mutableStore.filePath = path.join(root, "missing-directory", "db.json");
    await expect(
      store.mutate((database) => {
        database.messages.push({
          id: "message-1",
          agentId: "agent-1",
          runId: "run-1",
          role: "user",
          content: "must not become visible",
          createdAt: new Date().toISOString(),
        });
      }),
    ).rejects.toThrow();
    expect(store.snapshot().messages).toEqual([]);

    mutableStore.filePath = originalPath;
    await store.mutate((database) => {
      database.messages.push({
        id: "message-2",
        agentId: "agent-1",
        runId: "run-2",
        role: "user",
        content: "queue recovered",
        createdAt: new Date().toISOString(),
      });
    });
    expect(store.snapshot().messages.map((message) => message.content)).toEqual([
      "queue recovered",
    ]);
  });

  it("does not leave predictable temporary database files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-store-temp-test-"));
    temporaryDirectories.push(root);
    const store = new JsonStore(path.join(root, "db.json"));
    await store.initialize();
    await store.mutate((database) => {
      database.messages = [];
    });
    expect((await readdir(root)).sort()).toEqual(["db.json"]);
  });
});
