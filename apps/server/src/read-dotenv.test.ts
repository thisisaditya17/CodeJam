import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("safe dotenv reader", () => {
  it("returns configuration as data without executing shell syntax", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-dotenv-test-"));
    temporaryDirectories.push(root);
    const marker = path.join(root, "must-not-exist");
    const envPath = path.join(root, ".env.production");
    await writeFile(envPath, "ARK_API_KEY=$(touch " + marker + ")\n", "utf8");
    const scriptPath = fileURLToPath(
      new URL("../../../scripts/read-dotenv.mjs", import.meta.url),
    );
    const { stdout } = await execFileAsync(process.execPath, [
      scriptPath,
      envPath,
      "ARK_API_KEY",
    ]);
    expect(stdout).toBe("$(touch " + marker + ")");
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
