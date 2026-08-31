import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const command = "node controlled-runtime-check.mjs";
const child = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./controlled-runtime-check.mjs", import.meta.url))],
  {
    encoding: "utf8",
    env: { NO_COLOR: "1" },
  },
);
const exitCode = child.status ?? 1;
const childError = typeof child.stderr === "string" ? child.stderr.trim() : "";
const failureDetail =
  childError ||
  (child.error ? "Injected Runtime failure: " + child.error.message : "Injected Runtime failure");

const events = [
  { type: "runtime.proof.started" },
  {
    type: "runtime.operation.started",
    operation: {
      id: "fixture-command",
      command,
      status: "in_progress",
    },
  },
  {
    type: "runtime.operation.completed",
    operation: {
      id: "fixture-command",
      command,
      exit_code: exitCode,
      status: exitCode === 0 ? "completed" : "failed",
    },
  },
  {
    type: exitCode === 0 ? "runtime.proof.completed" : "runtime.proof.failed",
    ...(exitCode === 0
      ? { usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 } }
      : { error: { message: failureDetail } }),
  },
];

for (const event of events) process.stdout.write(JSON.stringify(event) + "\n");
process.exitCode = exitCode;
