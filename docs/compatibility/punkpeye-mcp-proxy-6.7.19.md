# `punkpeye/mcp-proxy` 6.7.19 compatibility report

Tested on 2026-09-24 with the published `mcp-failure-lab@0.10.0` package. The tests did not use a
local Failure Lab build.

## Versions

- `mcp-proxy`: npm `latest` = `6.7.19`
- npm integrity:
  `sha512-Nbfjj4VwVka1yAR/0fdD2G8borGOfjHEmfUzPFCH2nfQUNjWIij6s3gXMUhi2GUYE3FpUu8iFKE75ZQe/g1n8Q==`
- npm SHA-1: `173bd0ccc2023edb07017f0180a14f91698326d4`
- `punkpeye/mcp-proxy` main commit inspected: `7fbe09d7aa697a3b314af3016eb13ff10dc50b48`
- MCP Failure Lab: `0.10.0`
- Node.js: `26.5.0`
- Platform: macOS arm64

## Setup

```text
mcp-failure-lab runner -> Streamable HTTP -> mcp-proxy -> stdio -> mcp-failure-lab server
```

```bash
npx -y mcp-proxy@6.7.19 \
  --host 127.0.0.1 --port 3501 --server stream \
  --upstreamProtocol auto -- \
  npx -y mcp-failure-lab@0.10.0 serve
```

The runner connected to `http://127.0.0.1:3501/mcp`:

```bash
npx -y mcp-failure-lab@0.10.0 run SCENARIO.json \
  --target TARGET.json --report json
```

The CLI exposes stdio servers over HTTP/SSE. The reverse direction is handled by `mcp-remote` and
was not tested as part of this report.

## Results

| Scenario                                |                               Result |
| --------------------------------------- | -----------------------------------: |
| Baseline `ping`                         |                        Pass, 8.45 ms |
| 500 ms delay                            |                      Pass, 511.19 ms |
| 400 ms `hang` timeout                   |                      Pass, 402.76 ms |
| Same-session `ping` after timeout       |                        Pass, 5.16 ms |
| Duplicate response                      | First result accepted; recovery pass |
| Missing `jsonrpc`                       |       Bounded timeout; recovery pass |
| Invalid JSON-RPC version                |       Bounded timeout; recovery pass |
| Result containing both result and error |       Bounded timeout; recovery pass |
| Disconnect                              |     Immediate error; recovery failed |
| New session after disconnect            |          Failed with `Not connected` |
| Normal cleanup                          |                                 Pass |

Malformed calls reached the 1.5 second limit. The following `ping` passed on the same session.

## Disconnect finding

The `disconnect` tool closed the stdio child during a request. The call failed with
`Connection closed`. A same-session `ping` failed with `Not connected`. A new HTTP session also
failed its baseline `ping` with `Not connected`.

The proxy process remained running. Its subscription listener retried six times with increasing
delays, but each attempt failed with `SdkError: Not connected`. The stdio child was not restarted.

## Scope

Not tested: SSE, stateless HTTP, authentication, TLS, tunnels, event replay, request-size limits,
concurrency, idle timeout, or soak behavior.
