# Security policy

Volc Agent Launchpad is a hackathon proof of concept. Only the latest revision
on the default branch is supported.

## Report a vulnerability

Send the repository owner or event organizer the affected revision,
reproduction steps, impact, and suggested mitigation. Do not publish
credentials, personal data, or exploit details in an issue.

## Known limitations

- Shared demo token; no user identity, authorization, RBAC, or tenant isolation
- Browser-held bearer tokens remain exposed to a successful same-origin XSS
- No built-in TLS termination
- No per-Agent container boundary in the default ECS local-process mode
- Ordinary local containers, not hardened multi-tenant sandboxes
- Outbound traffic is port-limited, but DNS and HTTP(S) destinations remain broad
- Prompt-triggered command and file execution
- Ark key available to the server and active Runtime container
- Ark key stored in Terraform POC state
- Base image tags and the globally installed Codex package are not digest-locked
- The repository security script is a narrow guardrail, not a full SAST scanner

## Implemented controls

- Allowlisted and bounded request/configuration validation
- Shared-token authentication for non-loopback production deployments
- Security response headers, API no-store policy, mutation rate limits, and
  generic internal-error responses
- Central trace redaction plus redacted validation diagnostics
- Per-Agent Codex session directories and managed workspace path containment
- Symbolic-link-resistant instruction writes and unique atomic store writes
- Non-root, capability-dropped, no-new-privileges, read-only containers with a
  bounded temporary filesystem
- Restricted Terraform ingress, immutable repository revisions, and a required
  checksum for the downloaded Docker install script
- TypeScript strictness, focused security tests, npm advisory/signature checks,
  and deterministic repository guardrails

## Safe use

- Use a dedicated development machine or disposable ECS instance.
- Use a scoped, revocable Ark key and a unique `APP_AUTH_TOKEN`.
- Keep local use on loopback and restrict ECS Web and SSH CIDRs.
- Add HTTPS before sending the shared token over an untrusted network.
- Never mount production data or provide Volcengine account AK/SK to Agents.
- Stop the POC, destroy test resources, and revoke keys after the event.

Codex uses `workspace-write` when Landlock is available. On unsupported kernels,
startup warns and relies on the outer Docker or rootless Podman boundary. This
fallback is not tenant isolation.
