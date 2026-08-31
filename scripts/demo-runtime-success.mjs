import { access, readFile, writeFile } from "node:fs/promises";

const fileName = "recovery-proof.txt";
const expected = "Agent Black Box recovery succeeded\n";
let existed = true;
try {
  await access(fileName);
} catch {
  existed = false;
}

const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");

emit({ type: "runtime.proof.started" });
emit({
  type: "runtime.operation.started",
  operation: {
    id: "fixture-success-command",
    command: "write and verify recovery-proof.txt",
    status: "in_progress",
  },
});

await writeFile(fileName, expected, "utf8");
const actual = await readFile(fileName, "utf8");
if (actual !== expected) throw new Error("Workspace proof did not verify");

emit({
  type: "runtime.operation.completed",
  operation: {
    id: "fixture-success-command",
    command: "write and verify recovery-proof.txt",
    exit_code: 0,
    status: "completed",
  },
});
emit({
  type: "runtime.file.changed",
  changes: [{ path: fileName, kind: existed ? "update" : "add" }],
});
emit({
  type: "runtime.message",
  text: "Created and verified recovery-proof.txt through the credential-free Runtime proof.",
});
emit({
  type: "runtime.proof.completed",
  usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
});
