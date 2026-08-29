# Agent Black Box - three-minute demo script

## Preparation

1. Run `npm ci && npm run check` and leave the passing summary visible in a terminal tab.
2. Start the application with a disposable local state directory.
3. Create an Agent named `Recovery Builder` with the description
   `Diagnosable workspace automation`.
4. Append `?autofollow=1` to the local URL when API calls will drive the
   recording. This view follows real Runs and traces; it does not create or
   fabricate events.
5. Keep the Playground and Black Box panel visible at a 1280 x 720 viewport.

## Script

### 0:00-0:15 - Problem

**Narration:**

> Agent platforms often tell operators only that a Run failed. That is not
> enough to understand what happened, what was actually observed, or whether
> recovery is safe. Agent Black Box turns each Run into bounded, redacted,
> correlated evidence.

Show the Agent Black Box title and empty timeline.

### 0:15-0:30 - Architecture and evidence boundary

Show the architecture diagram in `docs/AGENT_BLACK_BOX.md`.

**Narration:**

> The existing React, Fastify, JSON-store, workspace, and Runtime lifecycle are
> preserved. Observable JSONL enters one allowlisted adapter, then one redaction
> and bounds layer, before deterministic sequence assignment and persistence.
> Hidden reasoning and raw command output are deliberately excluded.

### 0:30-1:05 - Successful workspace action

Select **Run credential-free success proof**.

Show these events appearing:

- `run.queued` and `run.started`;
- `runtime.started`;
- command start/completion;
- file change for `recovery-proof.txt`;
- zero-token usage;
- Runtime and Run completion.

Expand the file-change details.

**Narration:**

> This is not a static success message. The Runtime writes the file, reads it
> back, verifies the exact content, and emits the pinned event protocol. The
> complete path uses zero model tokens and remains reproducible without a
> credential.

### 1:05-1:45 - Controlled failure and redaction

Select **Run controlled failure proof**.

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

### 1:45-2:25 - Immutable linked retry

Select **Retry from persisted workspace**.

Show attempt 2 complete, `workspace_only` recovery mode, and the new
`recovery-proof.txt` file evidence. Switch the Run-history selector between
attempts 1 and 2, then use **View linked attempt 2**.

**Narration:**

> Retry creates a new immutable Run. It never rewrites failure into success.
> The server enforces one direct child, UUID idempotency, Agent availability,
> and the actual recovery mode in a serialized mutation. Both attempts remain
> inspectable and share the persisted workspace.

### 2:25-2:45 - Robustness evidence

Show the terminal with `45 tests passed`, the zero-vulnerability audit, and the
clean-clone result.

**Narration:**

> Tests cover redaction, event mapping, malformed input, bounded storage,
> historical data, restart interruption, timeout and cancellation boundaries,
> API validation, duplicate retry, busy-Agent rejection, and both Runtime
> command constructions.

### 2:45-3:00 - Close

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
