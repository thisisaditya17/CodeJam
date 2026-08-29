const canary = "techjam-demo-canary-not-a-secret";

const events = [
  { type: "thread.started", thread_id: "demo-fixture-thread" },
  { type: "turn.started" },
  {
    type: "item.started",
    item: {
      id: "fixture-command",
      type: "command_execution",
      command: "node controlled-runtime-check.mjs",
      aggregated_output: "",
      exit_code: null,
      status: "in_progress",
    },
  },
  {
    type: "item.completed",
    item: {
      id: "fixture-command",
      type: "command_execution",
      command: "node controlled-runtime-check.mjs",
      aggregated_output: "controlled failure",
      exit_code: 17,
      status: "failed",
    },
  },
  {
    type: "turn.failed",
    error: {
      message:
        "Injected Runtime failure. Authorization: Bearer " + canary,
    },
  },
];

for (const event of events) process.stdout.write(JSON.stringify(event) + "\n");
process.exitCode = 17;
