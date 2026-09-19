# Jev × MCP Failure Lab controlled A/B test

This harness reproduces the controlled decision-layer experiment documented in
[`docs/compatibility/jev-1.13.md`](../../docs/compatibility/jev-1.13.md). It asks Jev whether an
agent should accept, retry, or reject after a clean MCP result or deterministic failure evidence.

The duplicate-response and disconnect cases are paired A/B comparisons. Within each pair the fault
evidence is identical; only a successful follow-up `ping` is added to the recovery variant. The
state sent to Jev deliberately excludes MCP Failure Lab expectations and assertion status so that a
passing fault-injection test cannot be mistaken for a usable tool result.

Before calling Jev, the runner validates the actual MCP Failure Lab report. It checks the primary
outcome and result, requires the scenario assertions to pass, and verifies that recovery observers
returned a successful `ping`. Any mismatch aborts the run instead of substituting the intended
evidence. Assertion metadata is used only for this internal guard and is never sent to Jev.

## Cases

- `clean`
- `hang_timeout`
- `duplicate_no_recovery`
- `duplicate_with_recovery`
- `disconnect_no_recovery`
- `disconnect_with_recovery`

## Run

Requirements:

- Node.js 22.19 or later
- an OpenRouter API key with access to `typesafe/jev-1.13`

Keep the key in the environment; never put it in a file or command committed to the repository.

```sh
cd experiments/jev
export OPENROUTER_API_KEY="..."
RUNS=20 node run.mjs
```

The runner writes JSONL under `results/` and temporary MCP Failure Lab scenarios under
`tmp-scenarios/`. Summarize a run with:

```sh
node summarize.mjs results/ab-<timestamp>.jsonl
```

The summarizer prints the scenario table and recovery deltas and writes a sibling
`*.summary.json` file. Generated files are ignored by Git and should be reviewed for sensitive data
before publication.

## Scope

This is a controlled experiment of a downstream decision model. MCP Failure Lab supplies the fault
injection and operational evidence; Jev is the system being evaluated. The harness does not test
whether Jev implements MCP and is not an MCP client conformance benchmark.
