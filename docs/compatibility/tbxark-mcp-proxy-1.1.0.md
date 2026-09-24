# `tbxark/mcp-proxy` 1.1.0 compatibility report

Tested on 2026-09-24 with the published MCP Failure Lab package and the upstream release binary.

## Versions

- `tbxark/mcp-proxy`: `v1.1.0`
- Release commit: `a0e6dfb620020a729338e8c993aaa45667211de4`
- Darwin arm64 archive SHA-256:
  `8a82fab929a4191ea5d929c38200fc5807a85e0fd6c84d10f4f710405bdb4114`
- MCP Failure Lab: npm `latest` = `0.10.0`
- npm integrity:
  `sha512-9BLArjh99frHkXjFNt4A3wgI1r7MxUz9bsVlSjmLfGR25uPXPkmfR6tupwDnywcUSIR3SREimPbYKDgUnYg5iw==`
- Node.js: `26.5.0`
- Platform: macOS 26.6.2 arm64

## Configuration

Two stdio instances of `mcp-failure-lab@0.10.0` were mounted as `primary` and `control` behind
Streamable HTTP routes. Both used:

```json
{
  "timeout": "5s",
  "options": {
    "pingInterval": "250ms",
    "autoReconnect": true,
    "reconnectInterval": "250ms"
  }
}
```

`primary` was used for fault injection. `control` checked that a second downstream remained usable.

## Commands

```bash
gh release download v1.1.0 --repo tbxark/mcp-proxy \
  --pattern 'mcp-proxy_1.1.0_darwin_arm64.tar.gz'
shasum -a 256 mcp-proxy_1.1.0_darwin_arm64.tar.gz
tar -xzf mcp-proxy_1.1.0_darwin_arm64.tar.gz
```

```bash
npm view mcp-failure-lab dist-tags.latest version dist.integrity dist.shasum --json
npm install --ignore-scripts --no-audit --no-fund mcp-failure-lab@0.10.0
./mcp-proxy -config config.json -check-config
./mcp-proxy -config config.json -log-level debug
```

```bash
./node_modules/.bin/mcp-failure-lab run SCENARIO.json \
  --target TARGET.json --report json
```

Target URLs:

- `http://127.0.0.1:3601/primary/mcp`
- `http://127.0.0.1:3601/control/mcp`

## Results

| Scenario                                | Result                                            |
| --------------------------------------- | ------------------------------------------------- |
| Baseline `ping`                         | Pass, 5.72 ms                                     |
| 500 ms delay                            | Pass, 508.50 ms                                   |
| 400 ms `hang` timeout                   | Pass, 405.85 ms                                   |
| Same-session `ping` after timeout       | Pass, 9.95 ms                                     |
| Duplicate response                      | First result accepted; recovery pass              |
| Missing `jsonrpc`                       | Fault acknowledgement returned; recovery pass     |
| Invalid JSON-RPC version                | Fault acknowledgement returned; recovery pass     |
| Result containing both result and error | Immediate internal error; recovery pass           |
| Primary child disconnect                | Immediate `transport closed` error                |
| Control route after primary disconnect  | Pass, 2.90 ms                                     |
| Primary auto-reconnect                  | Pass after three failed 250 ms health probes      |
| New primary session after reconnect     | Pass, 5.19 ms                                     |
| Graceful proxy shutdown                 | Both stdio children received `SIGINT` and stopped |

The same HTTP session failed immediately after its stdio child exited. This is expected while the
proxy detects and rebuilds the downstream. The proxy logged three failed probes, initialized a new
child, and logged `Reconnected downstream`. New sessions then passed.

`/_healthz` and `/_readyz` remained available. The control route passed while the primary route was
recovering.

## Finding

No upstream defect was reproduced. The tested aggregation, timeout, isolation, reconnect, and
shutdown paths behaved as documented.

## Not tested

SSE, remote HTTP downstreams, OAuth, bearer-token routes, TLS, tool filters, startup retry,
concurrency, and soak behavior.
