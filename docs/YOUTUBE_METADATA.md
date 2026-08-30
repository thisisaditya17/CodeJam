# YouTube upload metadata

## Title

Agent Black Box — TikTok TechJam 2026 Track 1 Demo

## Description

Agent Black Box is lightweight Agent middleware that turns each observable Run
into a correlated, bounded, redacted timeline. It shows control-plane and
Runtime lifecycle, commands, file changes, duration, usage, explicit failure
boundaries, and immutable linked retries without exposing hidden reasoning or
raw command output.

This demonstration creates an Agent in the existing frontend, sends a fixed
credential-free workspace task through the Playground, shows the resulting
observable timeline, triggers a controlled non-zero Runtime failure with
server-side redaction, and recovers through a linked retry from the persisted
workspace. The proof paths use the same Runner, parser, store, API, polling,
and timeline components as ordinary Runs and do not use model inference.

The repository also includes a separately verified live free-quota ModelArk
Run, its usage ledger, and the trace evidence that distinguishes an
intermediate failed command from the model's optimistic final summary.

Repository: https://github.com/thisisaditya17/CodeJam

Chapters:

0:00 Problem, architecture, and truthful boundary
0:28 Frontend Agent creation and Playground task
0:47 Verified workspace success
1:08 Controlled failure and redaction
1:28 Linked retry and immutable history
1:40 Verification and conclusion

TikTok TechJam 2026 — Track 1: Agent Launchpad

## Upload settings

- Visibility: Public
- Audience: No, it is not made for kids
- Category: Science & Technology
- License: Standard YouTube License
- Comments: On
- Paid promotion: No
- Altered or synthetic content disclosure: answer according to YouTube's
  current upload form and the final recording contents

## Suggested tags

TikTok TechJam 2026, Agent Launchpad, Agent observability, Runtime tracing,
TypeScript, React, Fastify, ModelArk, hackathon
