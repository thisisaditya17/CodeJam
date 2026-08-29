# AGENTS.md - TikTok TechJam 2026 Agent Black Box

## Mission

Act as a pragmatic senior software engineer working under a hackathon deadline.

Build **Agent Black Box**: lightweight middleware that turns each Agent Run into a correlated, redacted, diagnosable timeline.

The mandatory product claim is intentionally narrow:

> Record observable Run and Runtime evidence, identify the most specific failure boundary the platform can honestly observe, and redact sensitive values before new trace data reaches persistent or user-visible trace sinks.

A linked retry from the persisted Agent workspace is a differentiating **stretch feature**, not part of the core completion gate.

Use this priority order:

1. Preserve the working Starter Kit and its persisted data.
2. Ship the complete trace journey and a reliable three-minute demo.
3. Keep every trace, failure, and recovery claim truthful.
4. Protect trace sinks from secrets and uncontrolled payloads.
5. Prefer focused, simple, tested changes.
6. Add linked retry only after the core trace gate passes.
7. Add polish last.

Never weaken validation, redaction, data integrity, or truthful evidence to make the demo appear successful.

## Scope Gates

### Core submission - mandatory

Ship all of the following before starting retry work:

- A real successful Agent Run produces a correlated, ordered timeline.
- A deterministic controlled failure travels through a real backend or Runtime boundary.
- The timeline identifies the supported failure boundary without invented diagnosis.
- New trace events are allowlisted, bounded, and redacted before trace persistence, trace APIs, trace UI, or application logging.
- A reviewer can inspect trace evidence from the existing frontend.
- Historical Starter Kit data still loads.
- Focused automated tests and `npm run check` pass.
- The README, one-page architecture diagram, and three-minute demo path are complete.

### Linked retry - stretch

Implement linked retry only when the core submission above works end to end and has tests.

If time is short, omit retry and submit a deeper, more reliable Glass Box implementation. Do not leave the core trace path unfinished to satisfy stretch requirements.

## Core Demonstration

The mandatory journey is:

1. Create or select an Agent in the existing frontend.
2. Invoke a real task through the existing Playground.
3. Capture real lifecycle, Runtime, Codex, usage, and terminal evidence that the platform can observe.
4. Show the Run as an ordered timeline.
5. Trigger a clearly labelled, deterministic failure at a real process, container, parser, or Runtime boundary.
6. Highlight the supported failure boundary and a safe actionable error.
7. Show that a canary secret in the controlled Runtime event was redacted from the trace API and UI.
8. Show that the platform remains understandable and usable afterward.

The full demonstration must fit comfortably within three minutes.

If linked retry ships, continue the demo by creating one new linked attempt from the same workspace and showing the original and retry as separate Runs.

## Preserve the Starter Kit

Build missing middleware, not a replacement platform.

Relevant extension seams include:

- `apps/server/src/types.ts`
- `apps/server/src/app.ts`
- `apps/server/src/agent-service.ts`
- `apps/server/src/store.ts`
- `apps/server/src/codex-runner.ts`
- `apps/server/src/container-codex-runner.ts`
- `apps/server/src/runner-factory.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/types.ts`
- `apps/web/src/styles.css`

Rules:

- Follow existing patterns before adding abstractions.
- Preserve Agent CRUD, lifecycle actions, Playground chat, asynchronous Runs, persistence, workspaces, and ModelArk integration.
- Prefer additive schema changes and a small tested normalization step for historical data.
- Do not replace the JSON store, Fastify server, Runner interface, React application, container launcher, or ModelArk integration.
- Keep host-process and container Runner behavior aligned through shared parsing and trace helpers where practical.
- Keep the browser as presentation only. Redaction, trace validation, sequence assignment, failure classification, retry eligibility, and concurrency enforcement belong on the server.
- Never use the platform repository as a Runtime Agent workspace or mount it writable into a Runtime.

## Baseline and Discovery

Before editing:

1. Read the README, architecture guide, extension guide, package scripts, nearby tests, and the files listed above.
2. Inspect `git status` and the existing diff. Preserve user work.
3. Run `npm run check` and record the exact result.
4. Run `npm audit --omit=dev` once to identify baseline production advisories. Record existing findings; do not run an uncontrolled automatic fix. Only update a dependency when the change is focused and the full gate remains green.
5. When credentials and a container engine are available, run `npm run poc` and verify create, Run, follow-up, restart, and workspace/session persistence.
6. If credentials or container access are unavailable, continue with offline checks and report exactly what remains unverified.

### Discover the pinned Codex event surface

The Starter Kit pins a Codex CLI version. Treat the actual pinned Runtime output as the implementation source of truth.

Before designing detailed trace events:

1. Execute one successful Run and one controlled failing Run.
2. Inspect the actual JSONL emitted by `codex exec --json`.
3. Enumerate event and item variants genuinely available in the pinned version.
4. Create small sanitized fixtures for only the variants used by the product.
5. Add parser tests.

Codex JSONL may include reasoning items. Do not persist or display hidden reasoning. Record only observable lifecycle, command, file-change, usage, explicit error, and terminal evidence that is safe and useful.

Never commit raw captures containing prompts, outputs, paths, environment values, credentials, or user data. If a desired detail is unavailable, instrument the closest honest platform boundary.

## Truthful Semantics

### Trace

A trace is a sequence of observable platform events, not hidden model reasoning.

Do not claim a command, tool call, file operation, model event, or failure cause was observed unless the actual event source exposes it. Do not use LLM-generated diagnosis on the critical path.

### Failure

Classify only boundaries the implementation can prove, for example:

- Runtime unavailable or failed to start;
- process or container non-zero exit;
- timeout;
- cancellation;
- output limit exceeded;
- explicit Codex error;
- malformed or unsupported Codex event;
- server restart interruption;
- unknown Runtime failure.

The current Starter Kit represents restart-interrupted active Runs as `cancelled`. Preserve that status for the core implementation and attach a structured reason such as `server_restart`. A logical `run.interrupted` trace event is acceptable; do not silently add a new Run status without an explicit migration and tests.

### Retry

A retry is a new attempt, not checkpoint restoration.

If retry is implemented:

- preserve the original failed Run and prompt;
- create a new Run ID;
- link it with `retryOfRunId`, `rootRunId`, and `attemptNumber` or equivalent fields;
- reuse the same Agent workspace;
- default to `workspace_only` recovery;
- reuse only a valid thread ID that existed before the failed attempt unless a typed Runner failure explicitly preserves a sanitized partial thread ID;
- record the actual recovery mode;
- never claim resume from the exact failed command, process state, or instruction pointer;
- do not silently append a duplicate human message.

## Minimal Trace Contract

Use repository naming conventions, but preserve these semantics:

- event ID and trace schema version;
- Agent ID, Run ID, and trace ID;
- deterministic per-Run sequence number;
- source, category, stable event type, and status;
- UTC timestamp and optional duration;
- short redacted summary;
- optional structured redacted failure details;
- small allowlisted metadata.

Practical default bounds:

- no more than 200 persisted trace events per Run;
- summaries no longer than 512 characters;
- serialized metadata no larger than 4 KiB per event;
- no arbitrary raw Runtime or model objects.

Sequence numbers, not timestamps alone, define ordering. Trace events are logically append-only after persistence even though the JSON store rewrites its backing file atomically.

Start with the smallest useful event set supported by real sources:

```text
run.queued
run.started
runtime.started
codex.thread_started
codex.command_started
codex.command_completed
codex.file_changed
codex.usage_reported
codex.error
runtime.completed
runtime.failed
run.completed
run.failed
run.cancelled
run.interrupted
```

Do not implement an event merely because it appears in this list. Omit variants that the pinned Runtime cannot support honestly.

Unknown or malformed JSONL must not crash the Run. Ignore it safely or record a bounded parser warning without retaining the raw line.

## Persistence

Prefer the lowest-risk additive design:

- add an optional `traceEvents` collection or equivalent to the existing database shape;
- normalize a missing collection to an empty array during initialization;
- keep historical version-1 files readable;
- if the database version is changed, implement and test an explicit version-1 to version-2 migration;
- assign sequence numbers and append events inside the store's serialized mutation path;
- never update previously persisted event contents to rewrite history.

Do not persist every streaming token or raw event. Persist only bounded judge-relevant evidence.

## Redaction Boundary

The redaction guarantee applies to the **new trace and diagnostic pipeline**:

- trace persistence;
- trace APIs;
- trace UI and browser state;
- application logs produced by the new middleware;
- sanitized fixtures, screenshots, and demo evidence.

The existing Starter Kit stores Playground prompts and final assistant messages. Do not claim global application-wide secret prevention unless that larger behavior is deliberately changed and tested. Avoid broad changes to existing message semantics during the hackathon.

Implement one central, pure, deterministic, idempotent redaction function. Apply allowlisting before serialization, then redact and bound strings.

At minimum test:

```text
ARK_API_KEY=secret-value
API_KEY=secret-value
api_key: secret-value
Authorization: Bearer secret-value
Bearer secret-value
password=secret-value
token: secret-value
client_secret=secret-value
```

Cover case differences, quoted and JSON-shaped values, multiline strings, URL query parameters, and secrets embedded in errors. Tests must prove the canary value is absent from serialized trace storage and API responses while useful non-secret context remains.

Place the demo canary inside a controlled Runtime event. Do not put it in the user prompt, an actual environment variable, a real credential, or the final assistant response.

## Event Ownership

### `AgentService`

Owns high-level Run lifecycle, Agent state, trace correlation, terminal outcome, restart normalization, and optional linked-retry creation.

### Runner implementations

Own Runtime availability, launch, exit, timeout, cancellation, output-limit detection, and observable Runtime metadata.

### Shared Codex parser

Owns only documented or observed JSONL variants, including safe thread, command, file-change, usage, agent-message, and explicit-error parsing. It must skip reasoning content and tolerate unknown lines.

### Trace recorder

Owns validation, redaction, bounds, sequence assignment, logical append-only persistence, and sanitized API projections.

## API and UI

Core API:

```text
GET /api/runs/:id/trace
```

Return only sanitized trace projections. Reuse the existing authorization boundary and error conventions.

Core UI scope:

- entry point from existing Run or Playground history;
- ordered timeline;
- event status, source/category, timestamp, and duration when available;
- expandable sanitized details;
- clear failure-boundary highlighting;
- visible explanation that capture is bounded and redacted;
- loading, empty, API-error, success, and terminal-failure states.

Reuse the existing visual language. Do not redesign navigation, CRUD, Playground, or the whole frontend. Use semantic controls, visible focus, and useful labels, but defer nonessential polish.

## Controlled Failure Fixture

Create one deterministic, safe, local fixture at a real Runner or process boundary.

A suitable fixture may emit valid supported JSONL, include a fake canary in an explicit error event, and exit with a known non-zero code. A timeout fixture is also acceptable if deterministic.

Requirements:

- label the failure as injected demonstration evidence;
- route it through the actual Runner, `AgentService`, persistence, trace API, and UI path;
- use no production credential or external write;
- require no hidden manual cleanup;
- leave the baseline real-model success path intact;
- document how to enable, reset, and reproduce it.

The fixture must not be a static UI event or hard-coded success response.

## Mandatory Tests

Focus on judge-relevant behavior:

- trace events correlate to the correct Agent and Run;
- sequence ordering is deterministic;
- supported secrets are removed and useful context remains;
- redaction is idempotent and bounded;
- known Codex events produce expected safe trace projections;
- unknown or malformed JSONL does not crash the Run;
- one successful Run produces a complete trace;
- one controlled failure produces the correct terminal classification;
- the trace API exposes no canary value;
- historical database data loads with empty trace defaults;
- existing Agent lifecycle and concurrency tests still pass.

Keep both Runner implementations compiling and share parsing/instrumentation. Full failure matrices for both providers, every cancellation race, and every UI edge state are stretch coverage.

If retry ships, additionally test:

- eligible failed or cancelled terminal Run;
- new Run ID and correct relationship fields;
- same workspace reuse and truthful recovery mode;
- immutable original Run;
- duplicate idempotency request returns the existing attempt or a clear conflict;
- retry is rejected while the Agent is busy.

Never weaken a legitimate existing test merely to obtain green results.

## Linked Retry Stretch Contract

Implement only after the core scope gate passes.

Suggested endpoint:

```text
POST /api/runs/:id/retries
{ "idempotencyKey": "client-generated-unique-value" }
```

Server requirements:

- allow selected terminal unsuccessful Runs only;
- validate eligibility and create the new Run in one serialized store mutation;
- recheck that the Agent is not busy;
- enforce uniqueness for the source Run and idempotency key;
- preserve the original Run and trace;
- append an explicit recovery action or trace event rather than duplicating a human chat message;
- use `workspace_only` unless safe thread reuse is proven;
- document that retrying arbitrary external side effects is not production-safe.

Minimum UI:

- show retry only when eligible;
- prevent duplicate clicks while pending;
- navigate between original and retry attempts;
- display the actual recovery mode.

## Implementation Order

### Phase 0 - baseline and event discovery

Run baseline checks, record dependency advisories, inspect the pinned JSONL surface, create sanitized fixtures, and write a short dependency-ordered plan.

### Phase 1 - trace contract, redaction, and persistence

Add minimal types, central redaction, additive storage normalization, and focused unit tests.

### Phase 2 - real instrumentation and API

Instrument `AgentService` and shared Runner parsing, classify one controlled failure, expose the sanitized trace API, and add integration tests.

### Phase 3 - minimum UI and demo

Add the timeline and failure highlighting. Verify the real success and controlled failure journeys end to end.

### Phase 4 - hardening and submission

Run the full gate, test from a clean start, remove captures and debug code, finish README and architecture diagram, and rehearse the three-minute demo.

### Phase 5 - linked retry stretch

Only if Phases 0-4 are complete, add workspace-only linked retry, idempotency, attempt navigation, and focused tests.

Do not begin broad UI work before backend trace persistence and the API are tested. Do not begin retry work before the core demo is reliable.

## Out of Scope

Do not implement unless the user explicitly changes scope:

- production OAuth, RBAC, or multi-user identity;
- a general-purpose policy engine;
- OpenTelemetry or a commercial observability backend;
- hidden-reasoning capture;
- global application-wide data-loss prevention;
- exact process checkpointing;
- arbitrary tool interception unsupported by the observed Runtime;
- a new database, queue, microservice, or distributed system;
- multi-Agent coordination or general memory management;
- ECS/Terraform work or multi-region deployment;
- hardened multi-tenant sandboxing or microVMs;
- a full frontend redesign;
- LLM diagnosis on the critical path;
- production-safe retries for arbitrary external side effects.

## Change Discipline

- Make small focused changes and follow nearby patterns.
- Separate pure parsing, redaction, classification, and normalization from I/O.
- Avoid repository-wide formatting and unnecessary dependencies.
- Use the existing package manager and lockfile.
- Do not use destructive Git commands, discard user work, commit, or push unless requested.
- Do not suppress type, lint, test, or security failures broadly.
- Never fabricate Runs, trace events, tests, metrics, or demo evidence.
- Remove raw captures, debug endpoints, noisy logs, hard-coded local paths, and temporary flags before completion.
- Never expose or display ModelArk credentials.

## Quality Gate

After each phase, run focused tests. Before completion, run:

```bash
npm run check
git diff --check
```

Also rehearse the success and controlled failure journeys and, when credentials are available, the original Playground acceptance flow.

If a check cannot run, report the exact command, blocker, behavior left unverified, and offline checks that passed. Never imply an unrun check passed.

## Documentation and Demo Evidence

Update the README with:

- the Agent-specific problem and narrow product claim;
- architecture and trust boundaries;
- observable-event and redaction semantics;
- setup, reproduction, and test commands;
- controlled fixture instructions;
- three-minute walkthrough;
- known limitations;
- linked-retry semantics only if retry ships;
- team contributions when applicable.

Create a one-page architecture diagram showing the React UI, Fastify API, `AgentService`, trace recorder/redactor, JSON store, both `AgentRunner` paths, Codex/ModelArk boundary, and controlled failure point. Add retry relationships only if implemented.

Document these limitations plainly:

- single-user, single-process JSON-store architecture;
- ordinary containers are not hardened multi-tenant isolation;
- traces contain observable events, not hidden reasoning;
- capture is allowlisted and incomplete by design;
- existing Playground prompts and final messages are outside the new trace-redaction guarantee;
- local Runtime is the supported judging path;
- retry is a new attempt, not exact checkpoint restoration, if implemented.

## Definition of Done

### Core complete

Core work is complete only when:

- the Starter Kit baseline remains functional;
- a real Run produces a correlated, ordered, redacted trace;
- a controlled failed Run exposes a truthful failure boundary;
- the canary secret is absent from trace persistence, trace APIs, UI, fixtures, screenshots, and new middleware logs;
- core parsing, redaction, persistence, success, and failure behavior has tests;
- `npm run check` passes;
- setup and demo work from a clean environment, or blockers are documented exactly;
- README and architecture diagram explain the evidence, boundary, and limitations;
- the final diff is focused and free of temporary hacks.

### Stretch retry complete

Retry is complete only when:

- it creates exactly one new linked immutable Run;
- it reuses the workspace;
- recovery mode and thread behavior are represented accurately;
- duplicate and busy-Agent paths are tested;
- the original Run and trace remain inspectable;
- the controlled retry succeeds.

Do not claim retry support unless every stretch condition above is satisfied.

## Completion Report

At the end of an implementation request, report only verified information under:

1. **Implemented** - observable behavior added.
2. **Files changed** - purpose of each important file.
3. **Verification** - exact commands and results.
4. **Demo path** - success and controlled failure steps, plus retry only if shipped.
5. **Remaining limitations** - unresolved or unverified risks.

Do not claim production readiness, complete observability, exact checkpoint recovery, or successful validation without evidence.
