# Official Everything server 2026.8.31 compatibility report

Tested on 2026-09-24 using the published `mcp-failure-lab@0.10.0` npm package. The
MCP Failure Lab source checkout was not used to execute the tests.

## Release identity

- MCP Failure Lab: npm `latest` = `0.10.0`
- Everything server: npm `latest` = `@modelcontextprotocol/server-everything@2026.8.31`
- Everything server npm integrity:
  `sha512-5U3OZh8Xq0Li4nA26l6uNvV9/1suMDuWSn+NjLZIhzinhMY6N3A4DCrxVecBGPf2PsNFKTEv5krxGPRwzxc7jQ==`
- Everything server npm SHA-1: `851a43bf34a83d9579aab22a2291d9473f10aeac`
- `modelcontextprotocol/servers` main commit inspected:
  `f46d9578190b476b3501923ea8977d899e8db2cb`

## Environment

- macOS arm64
- Node.js 26.5.0
- MCP Failure Lab 0.10.0
- Everything server 2026.8.31
- Everything server dependency: `@modelcontextprotocol/sdk^1.30.0`

## Setup

```bash
npm install \
  mcp-failure-lab@0.10.0 \
  @modelcontextprotocol/server-everything@2026.8.31
```

### stdio

```bash
node node_modules/@modelcontextprotocol/server-everything/dist/index.js stdio
```

### Streamable HTTP

```bash
PORT=3301 node \
  node_modules/@modelcontextprotocol/server-everything/dist/index.js streamableHttp
```

The runner connected to `http://127.0.0.1:3301/mcp`.

```bash
npx -y mcp-failure-lab@0.10.0 run SCENARIO.json \
  --target TARGET.json --report json
```

The matrix used only safe deterministic tools supplied by the Everything server:

- `echo` for baseline, input-error isolation, and recovery observation;
- `trigger-long-running-operation` for bounded delay and timeout behavior.

## Results

| Scenario                                      |                           stdio |                 Streamable HTTP |
| --------------------------------------------- | ------------------------------: | ------------------------------: |
| Baseline `echo`                               |                   Pass, 2.16 ms |                   Pass, 6.03 ms |
| 500 ms long-running operation                 |                 Pass, 506.75 ms |                 Pass, 506.32 ms |
| 400 ms timeout on a 2 s operation             | Timed out as bounded, 402.69 ms | Timed out as bounded, 403.69 ms |
| Same-session `echo` after timeout             |                   Pass, 5.92 ms |                   Pass, 9.92 ms |
| Invalid `echo` input                          |      Error as expected, 2.15 ms |      Error as expected, 3.39 ms |
| Same-session `echo` after input error         |                   Pass, 0.44 ms |                   Pass, 3.96 ms |
| Normal setup and cleanup                      |                            Pass |                            Pass |
| Cleanup immediately after timed-out operation |                     **Timeout** |                   Pass, 4.97 ms |

The Everything server has no disconnect or malformed-response tools, so those cases were not run.

## Reproducible finding

### stdio cleanup does not complete promptly after a cancelled long-running operation

Tracked in
[`modelcontextprotocol/servers#4846`](https://github.com/modelcontextprotocol/servers/issues/4846).

The test called `trigger-long-running-operation` with a two-second duration and a 400 ms client
timeout. Failure Lab cancelled the request and successfully called `echo` on the same session, but
closing the stdio client then exceeded its 400 ms cleanup bound:

```text
execute: timeout (~403 ms) - Request timed out
cancel: success
observe: success (~3-6 ms)
cleanup: timeout (~400-402 ms) - Client cleanup timed out
```

This reproduced three times. Normal stdio cleanup and the equivalent HTTP cleanup passed.

The published handler waits on timers and does not check cancellation. It may continue running
after cancellation and delay stdio shutdown.

Minimal reproduction:

1. Start `@modelcontextprotocol/server-everything@2026.8.31` over stdio.
2. Call `trigger-long-running-operation` with `duration: 2` and `steps: 4`.
3. Cancel the request after 400 ms.
4. Confirm that `echo` still succeeds.
5. Close the MCP client with a 400 ms bound; cleanup does not complete within that bound.

## Scope

Not tested: SSE, sampling, elicitation, roots, subscriptions, concurrency, event replay, or soak
behavior.
