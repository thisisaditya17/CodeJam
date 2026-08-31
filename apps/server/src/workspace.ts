import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Agent } from "./types.js";

export class WorkspaceManager {
  private canonicalRoot: string | null = null;

  constructor(private readonly root: string) {}

  workspacePath(agentId: string): string {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(agentId)) {
      throw new Error("Invalid Agent identifier for workspace path");
    }
    const root = this.canonicalRoot ?? path.resolve(this.root);
    const workspace = path.resolve(root, agentId);
    if (path.dirname(workspace) !== root) {
      throw new Error("Agent workspace must remain inside the configured root");
    }
    return workspace;
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    this.canonicalRoot = await realpath(this.root);
    await mkdir(path.join(this.canonicalRoot, ".deleted"), {
      recursive: true,
      mode: 0o700,
    });
  }

  async create(agent: Agent): Promise<void> {
    const workspace = this.workspacePath(agent.id);
    if (path.resolve(agent.workspacePath) !== workspace) {
      throw new Error("Refusing to create an Agent outside its managed workspace");
    }
    await mkdir(workspace, { recursive: false, mode: 0o700 });
    await this.writeInstructions(agent);
    await writeFile(
      path.join(workspace, ".gitignore"),
      [".codex/", "node_modules/", "dist/", ".env", "*.log", ""].join("\n"),
      { encoding: "utf8", mode: 0o600 },
    );
    await writeFile(
      path.join(workspace, "README.md"),
      [
        "# " + agent.name + " workspace",
        "",
        "Files created or edited by the Agent live here.",
        "The platform-generated AGENTS.md contains the current Agent instructions.",
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o600 },
    );
  }

  async writeInstructions(agent: Agent): Promise<void> {
    const workspace = await this.assertManagedWorkspace(agent);
    const content = [
      "# Platform-managed Agent instructions",
      "",
      "You are the coding Agent named " + agent.name + ".",
      agent.description ? "Purpose: " + agent.description : "",
      "",
      "## Instructions",
      "",
      agent.instructions ||
        "Help the user complete coding tasks in this workspace. Explain material results concisely.",
      "",
      "## Workspace rules",
      "",
      "- Work only inside this workspace unless the user explicitly requests otherwise.",
      "- Preserve existing user files and avoid destructive operations.",
      "- Build and test changes when practical.",
      "- Never print environment variables or credentials.",
      "",
      "This file is regenerated when the Agent configuration is updated.",
      "",
    ]
      .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
      .join("\n");
    const instructionsPath = path.join(workspace, "AGENTS.md");
    const handle = await open(
      instructionsPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_TRUNC |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
  }

  async archive(agent: Agent): Promise<string> {
    const workspace = await this.assertManagedWorkspace(agent);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = path.join(
      this.canonicalRoot ?? path.resolve(this.root),
      ".deleted",
      agent.id + "-" + timestamp,
    );
    await rename(workspace, destination);
    return destination;
  }

  async assertManagedWorkspace(agent: Pick<Agent, "id" | "workspacePath">): Promise<string> {
    const expected = this.workspacePath(agent.id);
    if (path.resolve(agent.workspacePath) !== expected) {
      throw new Error("Stored Agent workspace path does not match its managed workspace");
    }
    const [rootPath, workspaceStat] = await Promise.all([
      this.canonicalRoot ? Promise.resolve(this.canonicalRoot) : realpath(this.root),
      lstat(expected),
    ]);
    if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) {
      throw new Error("Agent workspace must be a real directory, not a symbolic link");
    }
    const workspacePath = await realpath(expected);
    if (path.dirname(workspacePath) !== rootPath) {
      throw new Error("Agent workspace resolved outside the configured root");
    }
    return workspacePath;
  }
}
