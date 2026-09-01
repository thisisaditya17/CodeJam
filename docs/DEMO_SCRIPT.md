# Agent Black Box - three-minute demo script

## Preparation

1. Run `npm ci && npm run check` and leave the passing summary visible in a terminal tab.
2. Start the application with a disposable local state directory.
3. Begin from the empty frontend so Agent creation is visible.
4. Keep the Playground and Black Box panel visible at a 1280 x 720 viewport.

## Script

### 0:00-0:28 - Problem, architecture, and evidence boundary

Show `docs/ARCHITECTURE_DIAGRAM.md`.

**Narration:**

> Agent platforms often stop at completed or failed. Agent Black Box turns
> each observable Run into bounded, redacted, correlated evidence.
>
> The existing React, Fastify, JSON-store, workspace, and Runtime lifecycle are
> preserved. Observable JSONL enters one allowlisted adapter, then one redaction
> and bounds layer, before deterministic sequence assignment and persistence.
> Hidden reasoning and raw command output are deliberately excluded.

### 0:28-0:47 - Create the Agent and select the task

Return to the empty frontend. Select **Create your first Agent**, enter
`Recovery Builder` and `Diagnosable workspace automation`, then create it.

### 0:47-1:08 - Playground workspace action

Select the green **Create and verify a workspace file with the local Runtime
proof** prompt, then press **Send** in the Playground.

Show these events appearing:

- `run.queued` and `run.started`;
- `runtime.started`;
- command start/completion;
- file change for `recovery-proof.txt`;
- zero-token usage;
- Runtime and Run completion.

Expand the file-change details.

**Narration:**

> The task is visibly invoked through the existing Playground. This is not a
> static success message: the Runtime writes the requested file, reads it back,
> verifies the exact content, and emits the Runtime-owned proof protocol. The complete
> path uses zero model tokens and is labelled as a local Runtime proof.

### 1:08-1:28 - Controlled failure and redaction

Select **Optional · Run controlled failure proof**.

Show:

- the command failure;
- the explicit Runtime error;
- non-zero exit code 17;
- `[REDACTED]` replacing the canary;
- the first failed step and final Runtime boundary.

**Narration:**

> The negative case runs through the same process or container boundary,
> parser, store, API, polling, and UI. The source event contains a safe canary,
> but neither the trace API nor browser receives its value. Diagnosis is
> deterministic: the command failed first, and the Runtime exited non-zero.

### 1:28-1:50 - Immutable linked retry

Select **Retry from persisted workspace**.

Show attempt 2 complete, `workspace_only` recovery mode, and the new
`recovery-proof.txt` file evidence. Switch the Run-history selector between
attempts 1 and 2, then use **View linked attempt 2**.

**Narration:**

> Retry creates a new immutable Run. It never rewrites failure into success.
> The server enforces one direct child, UUID idempotency, Agent availability,
> and the actual recovery mode in a serialized mutation. Both attempts remain
> inspectable and share the persisted workspace.

### 1:50-2:00 - Robustness evidence

Keep the completed retry visible while citing the validation results recorded
in the repository.

**Narration:**

> Tests cover redaction, event mapping, malformed input, bounded storage,
> historical data, restart interruption, timeout and cancellation boundaries,
> API validation, duplicate retry, busy-Agent rejection, and both Runtime
> command constructions.

### 2:00-2:05 - Close

Return to the completed linked retry.

**Narration:**

> Agent Black Box makes Agent infrastructure understandable without pretending
> to observe what it cannot. Every Run tells the truth.

## Recording checklist

- Record at 1280 x 720 or 1920 x 1080.
- Keep the final duration below three minutes.
- Do not show `.env`, credentials, terminal history containing secrets, or
  account identifiers.
- Do not use third-party logos, music, or copyrighted footage.
- Upload as a public YouTube video and verify playback in a signed-out window.

## Optional live-model evidence

When the free-quota model is active, select the persisted `Live Model Builder`
Run and show its `codex.usage_reported` details. Point out that the trace keeps
the intermediate failed test command even though the model's final message
claimed success, and show the **Completed with warnings** card. Do not rerun the model task solely for the demo; use the
persisted Run and the zero-inference verifier recorded in
`MODELARK_LIVE_VERIFICATION.md`.
