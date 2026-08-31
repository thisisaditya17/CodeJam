import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Agent } from "./types.js";
import { WorkspaceManager } from "./workspace.js";

const temporaryDirectories: string[] = [];
const agentId = "11111111-1111-4111-8111-111111111111";

function testAgent(workspacePath: string): Agent {
  const timestamp = new Date().toISOString();
  return {
    id: agentId,
    name: "Security test Agent",
    description: "",
    instructions: "Keep the workspace bounded.",
    status: "ready",
    workspacePath,
    codexThreadId: null,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("WorkspaceManager", () => {
  it("rejects path traversal and stored paths outside the managed root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-workspace-test-"));
    temporaryDirectories.push(root);
    const manager = new WorkspaceManager(path.join(root, "workspaces"));
    await manager.initialize();
    expect(() => manager.workspacePath("../outside")).toThrow(/Invalid Agent identifier/);

    const expected = manager.workspacePath(agentId);
    await manager.create(testAgent(expected));
    await expect(
      manager.assertManagedWorkspace(testAgent(path.join(root, "outside"))),
    ).rejects.toThrow(/does not match/);
  });

  it("does not follow an AGENTS.md symbolic link while updating instructions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-workspace-link-test-"));
    temporaryDirectories.push(root);
    const manager = new WorkspaceManager(path.join(root, "workspaces"));
    await manager.initialize();
    const workspacePath = manager.workspacePath(agentId);
    const agent = testAgent(workspacePath);
    await manager.create(agent);

    const target = path.join(root, "outside.txt");
    await writeFile(target, "must remain unchanged", "utf8");
    await rm(path.join(workspacePath, "AGENTS.md"));
    await symlink(target, path.join(workspacePath, "AGENTS.md"));

    await expect(manager.writeInstructions(agent)).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe("must remain unchanged");
  });
});
