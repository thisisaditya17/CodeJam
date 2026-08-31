# Devpost submission draft

## Project title

Agent Black Box

## Tagline

Every Agent Run tells the truth.

## Submission category

Track 1: Agent Launchpad - lightweight Agent middleware

## Project links

- Public repository: <https://github.com/thisisaditya17/CodeJam>
- Demo video: `[ADD_PUBLIC_YOUTUBE_URL]`

## Inspiration

Agent platforms often reduce a complex execution to `running`, `completed`, or
`failed`. When something goes wrong, operators need to know which observable
step failed, what evidence is safe to inspect, and whether a recovery attempt
will preserve history. Exposing raw Runtime output is not a safe answer because
it can contain credentials, user data, or internal reasoning.

## What it does

Agent Black Box adds a correlated, bounded, redacted timeline to every Agent
Run. It records control-plane lifecycle, Runtime boundaries, command execution,
file changes, duration, model usage when available, explicit errors, restart
interruption, and the terminal outcome.

The timeline is intentionally truthful. It records only event variants exposed
by the pinned Runtime protocol. Hidden reasoning and raw command output are
excluded. Strings and metadata pass through one server-side allowlist, bounds,
and redaction layer before they reach storage, APIs, logs, or the browser.

The project includes two reproducible Runtime proofs:

- a fixed, visible Playground task that performs and verifies a real workspace
  file write with zero model tokens;
- a controlled failure that exits non-zero and proves that a canary never
  reaches the trace API or UI.

The preserved model path was also verified live with the enabled free-quota
`seed-2-0-lite-260428` model. From the existing Playground and disposable
Docker Runtime, one Run created a TypeScript CLI and test, reported model usage,
and completed in 27 seconds.

An operator can create a linked retry from an unsuccessful Run. Retry creates a
new immutable attempt, reuses the persisted workspace, records the actual
workspace/thread recovery mode, prevents duplicate requests with a UUID
idempotency key, and keeps both attempts navigable.

## How it was built

The project extends the provided platform rather than replacing it:

- React and TypeScript for the existing Playground and Black Box inspector;
- Fastify for trace, controlled-proof, and retry APIs;
- the existing serialized JSON store for additive version-1-compatible trace
  and retry data;
- a shared adapter for the pinned Codex CLI JSONL event protocol;
- Docker for the disposable local Runtime path;
- Vitest for unit, service, API, failure-boundary, and retry verification.

No external observability service, database, queue, or OpenTelemetry dependency
is required. The local judging path is self-contained.

## Technical design

Each trace event has a schema version, trace/Run/Agent identifiers,
deterministic sequence number, stable deduplication key, source, type, status,
timestamp, safe summary, optional duration, and typed allowlisted metadata.

Storage is bounded to 256 events per Run, with capacity reserved for terminal
evidence. Commands retain only a redacted preview; file changes retain at most
32 sanitized workspace-relative paths; metadata is capped at 4 KiB. Historical
starter data loads with safe defaults without a database-version migration.

Failures use stable codes for Runtime availability, spawn, non-zero exit,
timeout, cancellation, output limit, explicit Runtime error, missing final
message, server restart, trace persistence, and unknown boundaries. Diagnosis
does not use an LLM.

## Challenges

- Preserving the existing asynchronous Run and one-active-execution semantics
  while persisting streaming evidence in deterministic order.
- Keeping local-process and disposable-container Runner behaviour aligned.
- Showing useful command and failure context without retaining raw output.
- Making retry idempotent and immutable without duplicating the human chat
  message or claiming exact checkpoint restoration.

## Accomplishments

- Successful, failed, cancelled, interrupted, and retried Runs remain
  distinguishable and inspectable.
- The controlled canary is absent from trace persistence, API responses, and UI.
- Duplicate retry requests return one existing child attempt; different keys
  conflict.
- The credential-free recovery proof starts from the Playground composer,
  persists the human task, and performs a real file action with zero model
  tokens.
- The live ModelArk Run reported 39,741 input tokens, including 14,704 cached
  tokens, and 1,209 output tokens. Together with the 46-token activation probe,
  verification used 40,996 of the 500,000 free tokens.
- The live trace exposed an intermediate failed test command that the model's
  final summary omitted. A zero-inference post-Run verifier confirmed the
  corrected files pass, demonstrating why observable evidence is more
  trustworthy than a terminal summary alone.
- The repository quality gate covers static security checks, typechecking,
  focused server tests, and both production builds. Final results should be
  recorded against the exact public submission commit after branch packaging.

## What was learned

Observability is most useful when its evidence boundary is explicit. A smaller
allowlisted timeline can be more trustworthy than a complete dump of Runtime
objects. Recovery also needs honest semantics: retry is a new attempt from
persisted state, not restoration of an instruction pointer or external side
effect.

## What's next

- Add pinned metadata for newly released ModelArk identifiers so the Runtime
  does not need Codex's fallback model metadata.
- Add safe model/tool provider adapters without changing the trace contract.
- Add export and retention controls for larger single-process deployments.
- Evaluate an external append-only backend while preserving the local POC path.

## Development tools and technologies

- Node.js 22+
- npm workspaces
- TypeScript
- React
- Fastify
- Zod
- Vitest
- Docker / Colima / Podman-compatible Runtime
- Codex CLI 0.111.0 Runtime protocol
- BytePlus ModelArk Responses-compatible integration path

## Data, APIs, and assets

- No training dataset is used.
- No third-party media or copyrighted assets are included.
- The interface uses local CSS and repository-owned screenshots.
- ModelArk credentials are optional for the deterministic success/failure and
  retry proof; real model inference remains available when an eligible model is
  active.

## Limitations

- Single-user, single-process JSON-store design.
- Ordinary containers are not hardened multi-tenant isolation.
- Trace capture is allowlisted and incomplete by design.
- Existing Playground prompts/final messages are outside the new trace-redaction
  guarantee.
- Credential-free proof Runs demonstrate Runtime, file, trace, and recovery
  behaviour rather than model intelligence.
- The pinned Codex version reports a non-fatal model-metadata fallback warning
  for `seed-2-0-lite-260428`; the warning is retained in the trace.
- Retrying arbitrary external side effects is not production-safe.

## Team contribution

Solo submission. Product design, implementation, testing, documentation, and
demonstration are owned by the submitting participant.
