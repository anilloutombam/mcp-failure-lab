# `punkpeye/mcp-proxy` 6.7.19 compatibility report

Tested on 2026-09-24 with published npm packages.

## Versions

- `mcp-proxy`: npm `latest` = `6.7.19`
- npm integrity:
  `sha512-Nbfjj4VwVka1yAR/0fdD2G8borGOfjHEmfUzPFCH2nfQUNjWIij6s3gXMUhi2GUYE3FpUu8iFKE75ZQe/g1n8Q==`
- npm SHA-1: `173bd0ccc2023edb07017f0180a14f91698326d4`
- `punkpeye/mcp-proxy` main commit inspected: `7fbe09d7aa697a3b314af3016eb13ff10dc50b48`
- MCP Failure Lab: `0.10.0`
- Node.js: `26.5.0`
- Platform: macOS arm64

## Commands

```bash
npx -y mcp-proxy@6.7.19 \
  --host 127.0.0.1 --port 3501 --server stream \
  --upstreamProtocol auto -- \
  npx -y mcp-failure-lab@0.10.0 serve
```

```bash
npx -y mcp-failure-lab@0.10.0 run SCENARIO.json \
  --target TARGET.json --report json
```

Target URL: `http://127.0.0.1:3501/mcp`.

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

Malformed calls reached the 1.5 second limit. The next `ping` passed.

## Disconnect

`disconnect` closed the stdio child. The call failed with `Connection closed`. A same-session
`ping` and a new-session `ping` both failed with `Not connected`.

The proxy stayed running. Its subscription listener retried six times; every attempt returned
`SdkError: Not connected`. The child was not restarted.

Upstream tracking: [punkpeye/mcp-proxy#112](https://github.com/punkpeye/mcp-proxy/issues/112).

## Not tested

SSE, stateless HTTP, authentication, TLS, tunnels, event replay, request-size limits, concurrency,
idle timeout, and soak behavior.
