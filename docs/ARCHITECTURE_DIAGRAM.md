# Agent Black Box - one-page architecture

![Agent Black Box one-page architecture showing the trusted control plane, disposable Runtime, trace redaction boundary, storage, and linked retry](assets/agent-black-box-architecture.svg)

The trace boundary records only observable, allowlisted Runtime evidence. It
excludes hidden reasoning and raw command output, and applies bounds and
redaction before persistence or display. The ModelArk credential is forwarded
only to ordinary model-backed Runs; controlled proofs execute without it.
