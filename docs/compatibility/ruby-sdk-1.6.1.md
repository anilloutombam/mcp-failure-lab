# Ruby MCP SDK 1.6.1 compatibility

Test date: 2026-10-05. Server: published `mcp-failure-lab@0.12.0`, not the source checkout.

## Results

60 case executions: 48 passed and 12 failed. Each applicable case ran three times using a fresh client and the legacy `2025-11-25` lifecycle.

| Case                            | stdio | Streamable HTTP |
| ------------------------------- | ----: | --------------: |
| Baseline initialization         |   3/3 |             3/3 |
| Bounded delay and recovery      |   3/3 |             3/3 |
| Duplicate response and recovery |   3/3 |             3/3 |
| Hang cancellation and recovery  |   3/3 |             3/3 |
| Response after cancellation     |   3/3 |             N/A |
| Protocol-ping liveness          |   3/3 |             3/3 |
| Session loss after response     |   N/A |             3/3 |
| Missing `jsonrpc` rejection     |   0/3 |             0/3 |
| Invalid JSON-RPC version        |   0/3 |             0/3 |
| Result with error rejection     |   3/3 |             3/3 |
| Disconnect and fresh reconnect  |   3/3 |             3/3 |

Failures denote unmet harness assertions, not independently established upstream defects.

## Environment

- Ruby 3.4.11
- Official Ruby MCP SDK (`mcp`) 1.6.1
- Node.js 22 container runtime
- Published `mcp-failure-lab@0.12.0`
- Protocol `2025-11-25`

The container pins the SDK and its optional HTTP dependencies. Both transports used the SDK's built-in client implementations.

## Findings from the run

The missing-`jsonrpc` and `jsonrpc: "1.0"` response variants were accepted on both transports in all three repeats. The result-with-error variant was rejected, after which the same client successfully completed `ping` in all repeats.

Baseline, bounded delay, duplicate-response recovery, and disconnect followed by a fresh-client reconnect passed on both transports in all repeats.

Cancelling a hanging request after 250 ms raised `MCP::CancelledError`, and the same client completed `ping` on both transports. The stdio late-response case also raised `MCP::CancelledError`; after a one-second wait, the same client completed `ping`.

Server-initiated protocol ping succeeded on both transports with a 1,000 ms liveness deadline, followed by a successful tool `ping`. For HTTP session loss activated after the response, the next request failed and a fresh client completed `ping`.

These observations require source review or a minimal reproducer before they should become reviewed Findings or upstream reports.

## Reproduction

```bash
docker build -t mcp-failure-lab-ruby-sdk ./experiments/ruby-sdk
mkdir -p work/ruby-sdk-results
docker run --rm \
  -v "$PWD/work/ruby-sdk-results:/results" \
  mcp-failure-lab-ruby-sdk
```

The machine-readable output is written to `work/ruby-sdk-results/ruby-sdk-1.6.1-results.json`.

## Scope

The late-response fault is stdio-only; session loss is HTTP-only. Hang recovery here uses explicit cancellation, not a transport read timeout. Session loss covers `after_response`, not `during_request`. Cancellation is triggered by a timer, without a server activation acknowledgement.

Modern lifecycle behavior, authentication, and concurrent fault isolation remain untested. This report covers the legacy lifecycle only and should not be treated as full SDK conformance coverage.
