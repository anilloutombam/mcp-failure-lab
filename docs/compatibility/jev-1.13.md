# Jev 1.13 recovery-evidence decision experiment

Tested on 2026-09-19 using operational evidence normalized from
`mcp-failure-lab@0.10.0` and the `typesafe/jev-1.13-20260917` model served through OpenRouter.

## Question

Does explicit evidence of successful recovery change Jev's decision after the same MCP fault?

This is a decision-layer experiment, not an MCP client conformance benchmark. Jev did not connect
to an MCP server or implement an MCP transport. It received normalized evidence about an MCP call
and selected `accept`, `retry`, or `reject`.

## Method

The harness ran each of six cases 20 times with the same model and decision schema. The two A/B
pairs held the original fault evidence constant and changed only the recovery field:

- duplicate response, without recovery evidence vs. with a successful follow-up `ping`;
- disconnect, without recovery evidence vs. with a successful follow-up `ping`.

The clean result and hang timeout were controls. Jev saw only operational evidence such as outcome,
fault type, result usability, and optional recovery. MCP Failure Lab's expected outcome, assertion
status, and other test-oracle metadata were not included. This normalization prevents “the fault
occurred as expected” from being confused with “the tool result is safe to use.”

Before each Jev request, the harness validated the actual MCP Failure Lab report, including its
primary outcome, result content, assertion state, and any recovery observer `ping`. A mismatch would
abort the run. Test-oracle metadata was used only by this validation guard and was not included in
the evidence shown to Jev.

The decision meanings were:

- `accept`: safe to continue with the current result and session;
- `retry`: repeat or reconnect before continuing;
- `reject`: do not use the current result or session.

The reproducible runner and summarizer are in [`experiments/jev`](../../experiments/jev/README.md).
No API key or raw credential is stored in the repository.

## Results

| Scenario                   | Runs | Accept choices | Retry choices | Reject choices | Avg P(accept) | Avg P(retry) | Avg P(reject) | Avg confidence | Avg latency (ms) | Total cost |
| -------------------------- | ---: | -------------: | ------------: | -------------: | ------------: | -----------: | ------------: | -------------: | ---------------: | ---------: |
| `clean`                    |   20 |             20 |             0 |              0 |         0.988 |            0 |         0.012 |          0.984 |              513 | 0.00037212 |
| `hang_timeout`             |   20 |              0 |             0 |             20 |             0 |        0.415 |         0.585 |          0.376 |              483 | 0.00038052 |
| `duplicate_no_recovery`    |   20 |              0 |             0 |             20 |             0 |        0.102 |         0.898 |          0.846 |              456 | 0.00037968 |
| `duplicate_with_recovery`  |   20 |             20 |             0 |              0 |         0.535 |        0.351 |         0.115 |          0.301 |              502 | 0.00040068 |
| `disconnect_no_recovery`   |   20 |              0 |             0 |             20 |             0 |         0.33 |         0.669 |          0.503 |              445 | 0.00038388 |
| `disconnect_with_recovery` |   20 |              0 |            20 |              0 |         0.162 |         0.79 |         0.048 |          0.687 |              486 | 0.00040488 |

### Recovery deltas

Each delta is the average value with recovery evidence minus the average without it.

| Comparison                 | Δ P(accept) | Δ P(retry) | Δ confidence |
| -------------------------- | ----------: | ---------: | -----------: |
| Duplicate recovery effect  |      +0.535 |     +0.249 |       -0.545 |
| Disconnect recovery effect |      +0.162 |      +0.46 |       +0.184 |

## Interpretation

Recovery evidence materially changed Jev's decision. For duplicate-response faults, successful
recovery shifted the model from 20/20 reject to 20/20 accept. For disconnect faults, successful
recovery shifted the model from 20/20 reject to 20/20 retry.

The two recovered faults did not collapse to the same policy. A successful `ping` after a duplicate
response made continuing plausible, while the same recovery evidence after a disconnect made retry
the consistent choice. Duplicate recovery also reduced average confidence, whereas disconnect
recovery increased it.

These results describe this prompt, normalized evidence representation, model build, and 20-run
sample. They should not be generalized into a claim about all Jev behavior, overall MCP resilience,
or MCP client conformance.
