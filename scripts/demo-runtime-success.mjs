import { access, readFile, writeFile } from "node:fs/promises";

const fileName = "recovery-proof.txt";
const expected = "Agent Black Box credential-free success proof\n";
let existed = true;
try {
  await access(fileName);
} catch {
  existed = false;
}

const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");

emit({ type: "thread.started", thread_id: "demo-success-fixture-thread" });
emit({ type: "turn.started" });
emit({
  type: "item.started",
  item: {
    id: "fixture-success-command",
    type: "command_execution",
    command: "write and verify recovery-proof.txt",
    aggregated_output: "",
    exit_code: null,
    status: "in_progress",
  },
});

await writeFile(fileName, expected, "utf8");
const actual = await readFile(fileName, "utf8");
if (actual !== expected) throw new Error("Workspace proof did not verify");

emit({
  type: "item.completed",
  item: {
    id: "fixture-success-command",
    type: "command_execution",
    command: "write and verify recovery-proof.txt",
    aggregated_output: "workspace proof verified",
    exit_code: 0,
    status: "completed",
  },
});
emit({
  type: "item.completed",
  item: {
    id: "fixture-success-file",
    type: "file_change",
    changes: [{ path: fileName, kind: existed ? "update" : "add" }],
    status: "completed",
  },
});
emit({
  type: "item.completed",
  item: {
    id: "fixture-success-message",
    type: "agent_message",
    text: "Created and verified recovery-proof.txt through the credential-free Runtime proof.",
  },
});
emit({
  type: "turn.completed",
  usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
});
