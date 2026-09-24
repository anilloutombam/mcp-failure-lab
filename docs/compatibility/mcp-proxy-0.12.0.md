# `sparfenyuk/mcp-proxy` 0.12.0 compatibility report

Tested on 2026-09-24 using the published `mcp-failure-lab@0.10.0` npm package. The
MCP Failure Lab source checkout was not used to execute the tests.

## Release identity

- MCP Failure Lab: npm `latest` = `0.10.0`, published 2026-09-19
- npm tarball integrity:
  `sha512-9BLArjh99frHkXjFNt4A3wgI1r7MxUz9bsVlSjmLfGR25uPXPkmfR6tupwDnywcUSIR3SREimPbYKDgUnYg5iw==`
- npm tarball SHA-1: `871bf35fb52d8be6d16d9c819a5c883158ed22c2`
- `mcp-proxy`: PyPI `0.12.0`
- `sparfenyuk/mcp-proxy` main commit inspected: `153a96a61fde2bf5a23961c64a3dd96b5e385108`
- Protocol negotiated by the Python proxy client: `2025-11-25`

## Environment

- macOS arm64
- Node.js 26.5.0
- Python 3.12.14
- `mcp-proxy` 0.12.0
- Python MCP SDK 1.30.0 for the completed scenario matrix; see the clean-install defect below

## Setup

### HTTP server through a stdio proxy

```text
mcp-failure-lab runner -> stdio -> mcp-proxy -> Streamable HTTP -> mcp-failure-lab server
```

```bash
npx -y mcp-failure-lab@0.10.0 serve \
  --transport http --host 127.0.0.1 --port 3100 --path /mcp
```

```bash
mcp-proxy --transport streamablehttp http://127.0.0.1:3100/mcp
```

### stdio server through an HTTP proxy

```text
mcp-failure-lab runner -> Streamable HTTP -> mcp-proxy -> stdio -> mcp-failure-lab server
```

```bash
mcp-proxy --host 127.0.0.1 --port 3200 -- \
  npx -y mcp-failure-lab@0.10.0 serve
```

The runner connected to `http://127.0.0.1:3200/mcp`.

```bash
npx -y mcp-failure-lab@0.10.0 run SCENARIO.json \
  --target TARGET.json --report json
```

## Results

| Scenario                                |     HTTP server through stdio proxy |           stdio server through HTTP proxy |
| --------------------------------------- | ----------------------------------: | ----------------------------------------: |
| Baseline `ping`                         |                       Pass, 7.29 ms |                             Pass, 8.02 ms |
| 500 ms bounded delay                    |                     Pass, 520.06 ms |                           Pass, 509.53 ms |
| 400 ms `hang` timeout                   |          Pass, timeout in 402.92 ms |                Pass, timeout in 405.76 ms |
| Same-session `ping` after timeout       |                      Pass, 22.64 ms |                             Pass, 9.14 ms |
| Missing `jsonrpc`                       | Timed out as bounded; recovery pass |       Timed out as bounded; recovery pass |
| Invalid JSON-RPC version                | Timed out as bounded; recovery pass |       Timed out as bounded; recovery pass |
| Result containing both result and error |      Immediate error; recovery pass |            Immediate error; recovery pass |
| Disconnect and same-session recovery    |                            **Fail** |                                  **Fail** |
| Setup and cleanup lifecycle             |    Pass in all non-disconnect cases | Pass in all cases at the outer HTTP layer |

Missing or invalid `jsonrpc` responses reached the 1.5 second limit; the following `ping` passed.
A response containing both `result` and `error` returned an immediate tool error. Timeout recovery
also passed in both directions.

## Reproducible findings

### 1. Clean `mcp-proxy` 0.12.0 install is incompatible with the resolved MCP SDK

Tracked in [`sparfenyuk/mcp-proxy#235`](https://github.com/sparfenyuk/mcp-proxy/issues/235).

`mcp-proxy` 0.12.0 declares `mcp>=1.27.1` without an upper bound. On 2026-09-24 a clean install
resolved `mcp==2.2.0`, after which even `mcp-proxy --version` crashed:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install mcp-proxy==0.12.0
.venv/bin/mcp-proxy --version
```

Observed exception:

```text
ImportError: cannot import name 'request_ctx' from 'mcp.server.lowlevel.server'
```

The import originates in `mcp_proxy/proxy_server.py`. Pinning the SDK restored startup and allowed
the compatibility matrix to run:

```bash
.venv/bin/python -m pip install 'mcp>=1.27.1,<2'
```

### 2. Transport disconnect is not recovered

Related upstream reports:

- HTTP/SSE reconnection: [`sparfenyuk/mcp-proxy#75`](https://github.com/sparfenyuk/mcp-proxy/issues/75)
- Exited stdio child remains unavailable: [`sparfenyuk/mcp-proxy#247`](https://github.com/sparfenyuk/mcp-proxy/issues/247)

In stdio-to-HTTP mode, invoking Failure Lab's `disconnect` tool caused the upstream HTTP request to
end without a response. `mcp-proxy` emitted an unhandled `ExceptionGroup` rooted in
`httpx.RemoteProtocolError: Server disconnected without sending a response` and exited. The
downstream call did not receive an error promptly; it reached the runner's 1.5 second timeout. A
same-session `ping` then failed with `Connection closed`.

In HTTP-to-stdio mode, `disconnect` closed the backing Failure Lab stdio process. The proxy returned
an MCP error result containing `Connection closed`, but a same-session `ping` also returned an error.
A completely new HTTP session then failed its baseline `ping`, showing that the long-running proxy
service did not restart the default stdio child after it exited.

Minimal reproduction for the second direction:

```bash
mcp-proxy --host 127.0.0.1 --port 3200 -- \
  npx -y mcp-failure-lab@0.10.0 serve

# In one MCP session: call `disconnect`, then call `ping`.
# Then open a new MCP session and call `ping` again.
```

## Scope

Not tested: OAuth, TLS, SSE-only endpoints, named servers, concurrency, or soak behavior.
