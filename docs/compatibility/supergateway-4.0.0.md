# `supercorp-ai/supergateway` 4.0.0 compatibility report

Tested on 2026-09-24 using the published `mcp-failure-lab@0.10.0` npm package. The
MCP Failure Lab source checkout was not used to execute the tests.

## Release identity

- MCP Failure Lab: npm `latest` = `0.10.0`
- Supergateway: npm `latest` = `4.0.0`, published 2026-09-20
- Supergateway npm integrity:
  `sha512-puVDDT5lB1tf0Pa3iw42e0yomEIInCweFmkb38zPjAsA1zh+sbq4PwzA5brrUkjVTOUuVMemsNdRnMEc0DBKAQ==`
- Supergateway npm SHA-1: `2ec29ed58e150d2f0bf9a015be8e0784a8d3b80a`
- `supercorp-ai/supergateway` main commit inspected:
  `874951c7aa5beba23fbba1e6e567795435c47c64`
- Protocol negotiated during the stateful HTTP tests: `2025-11-25`

## Environment

- macOS arm64
- Node.js 26.5.0
- MCP Failure Lab 0.10.0
- Supergateway 4.0.0

## Setup

### HTTP server through a stdio gateway

```text
mcp-failure-lab runner -> stdio -> supergateway -> Streamable HTTP -> mcp-failure-lab server
```

```bash
npx -y mcp-failure-lab@0.10.0 serve \
  --transport http --host 127.0.0.1 --port 3400 --path /mcp
```

```bash
npx -y supergateway@4.0.0 \
  --streamableHttp http://127.0.0.1:3400/mcp \
  --outputTransport stdio --logLevel none
```

### stdio server through a stateful HTTP gateway

```text
mcp-failure-lab runner -> Streamable HTTP -> supergateway -> stdio -> mcp-failure-lab server
```

```bash
npx -y supergateway@4.0.0 \
  --stdio "npx -y mcp-failure-lab@0.10.0 serve" \
  --outputTransport streamableHttp --stateful \
  --sessionTimeout 60000 --protocolVersion 2026-07-28 \
  --port 3401 --logLevel info
```

The runner connected to `http://127.0.0.1:3401/mcp` and negotiated `2025-11-25`.

```bash
npx -y mcp-failure-lab@0.10.0 run SCENARIO.json \
  --target TARGET.json --report json
```

## Results

| Scenario                                |           HTTP server through stdio gateway | stdio server through stateful HTTP gateway |
| --------------------------------------- | ------------------------------------------: | -----------------------------------------: |
| Baseline `ping`                         |                               Pass, 5.70 ms |                              Pass, 6.25 ms |
| 500 ms bounded delay                    |                             Pass, 509.54 ms |                            Pass, 509.08 ms |
| 400 ms `hang` timeout                   |                             Pass, 403.57 ms |                            Pass, 403.72 ms |
| Same-session `ping` after timeout       |                              Pass, 13.23 ms |                             Pass, 10.47 ms |
| Duplicate response                      |        First result accepted; recovery pass |       First result accepted; recovery pass |
| Missing `jsonrpc`                       |              Bounded timeout; recovery pass |             Bounded timeout; recovery pass |
| Invalid JSON-RPC version                |              Bounded timeout; recovery pass |             Bounded timeout; recovery pass |
| Result containing both result and error |              Bounded timeout; recovery pass |             Bounded timeout; recovery pass |
| Transport disconnect                    | Immediate error; same-session recovery pass |            Immediate error; session closed |
| New session after disconnect            |    Not required; original session recovered |                              Pass, 4.11 ms |
| Normal setup and cleanup                |                                        Pass |                                       Pass |

Malformed calls reached the 1.5 second limit. The following `ping` succeeded. A response containing
both `result` and `error` was forwarded, rejected by the client, and timed out.

## Disconnect behavior

- HTTP-to-stdio: the upstream request failed immediately. The stdio session remained usable;
  `ping` passed in 2.59 ms.
- stdio-to-HTTP: the child exited and Supergateway removed its session. Further requests returned
  `Session not found`. A new session started a new child and passed `ping` in 4.11 ms.

Failure Lab exited 2 for these cases because the external adapter classifies an execution transport
error as a lifecycle failure, including when the scenario expects an error.

## Findings

No Supergateway defect was reproduced. A stateful HTTP session is not restarted after its child
exits; the client must initialize a new session.

## Scope

Not tested: SSE, WebSockets, stateless HTTP, authentication, CORS, concurrency, continuation expiry,
idle timeout, or soak behavior.
