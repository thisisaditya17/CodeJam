# Live ModelArk verification and free-token ledger

## Guardrails

- Region: Asia Pacific (Johor), `ap-southeast-1`
- Responses API base URL: `https://ark.ap-southeast.bytepluses.com/api/v3`
- Model: `seed-2-0-lite-260428`
- Billing mode observed before inference: Free Credits Only Mode
- Account behavior observed: free usage with automatic model suspension when
  the 500,000-token quota is exhausted
- Internal switch threshold: 400,000 cumulative tokens
- Paid overage, recharge, and paid-plan settings were not enabled or changed

## Usage

| Call | Input | Cached input | Output | Total |
| --- | ---: | ---: | ---: | ---: |
| Minimal activation probe | 38 | 0 | 8 | 46 |
| One live Track 1 Playground Run | 39,741 | 14,704 | 1,209 | 40,950 |
| **Cumulative verification usage** |  |  |  | **40,996** |

The verification used about 8.2% of the 500,000-token quota and stopped
359,004 tokens before the 400,000-token switch threshold. No additional model
request was made.

## End-to-end result

The user created `Live Model Builder` in the existing frontend and sent one
bounded task through the Playground. The disposable Docker Runtime used the
normal Codex/ModelArk path and completed in 27 seconds with 18 trace events.
The final workspace contained:

- `greet.ts`, which prints `Hello from Agent Black Box`;
- `greet.test.ts`, containing one Node built-in test.

The Run preserved the normal thread, command, usage, Runtime, and terminal
events. It also retained a non-fatal warning that the pinned Codex version did
not have metadata for the newer model identifier.

## Truthful verification note

The model ran its requested test once, received exit code 1 because the first
test imported `./greet.js`, corrected the import to `./greet.ts`, and then
claimed the test had passed without rerunning it. Agent Black Box retained the
failed command despite the completed Run and optimistic final message.

No second inference request was made. A local, zero-inference verifier then ran
the corrected test and observed one passing test, followed by the CLI output
`Hello from Agent Black Box`. This distinction is deliberate: trace evidence
records what actually ran, while post-Run verification is reported separately.
