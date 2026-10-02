# Official Java SDK 2.0.1 compatibility report

Tested on 2026-10-02 against the published `mcp-failure-lab@0.11.0` npm package. The
MCP Failure Lab source checkout was not used to execute the server.

## Release identity

- npm package: `mcp-failure-lab@0.11.0`
- npm integrity:
  `sha512-NXwSIP6hwO29fQYiWNWWF7iVhJ3aTRLO1cxAr+UNteBAHHNSivK3hcpM/RqT7G3DmudxtHqt6lThbCJxcGmtyw==`
- npm SHA-1: `adee5052d9d30efd4774e703b875e1b22d7ce232`
- Official Java MCP SDK: `io.modelcontextprotocol.sdk:mcp:2.0.1`
- Negotiated protocol: `2025-11-25`

## Environment and method

- Linux arm64 container
- Eclipse Temurin Java 21.0.9
- Maven 3.9.11
- Node.js 22.23.3
- npm 10.9.9

The reproducible harness is in [`experiments/java-sdk`](../../experiments/java-sdk/README.md).
It starts every stdio server with `npx -y mcp-failure-lab@0.11.0 serve` and starts the HTTP
server with the same pinned package. Every case was repeated three times. Durations below are
the median end-to-end harness durations in milliseconds and include client initialization and
cleanup.

## Results

| Scenario                              |                stdio |   Streamable HTTP | Result |
| ------------------------------------- | -------------------: | ----------------: | ------ |
| Initialize, list tools, and ping      |               692 ms |             13 ms | Pass   |
| 250 ms bounded delay                  |               916 ms |            272 ms | Pass   |
| Two-second delay timeout and recovery |             1,652 ms |          1,027 ms | Pass   |
| Duplicate response and recovery       |               776 ms |            126 ms | Pass   |
| Missing `jsonrpc` and recovery        | **Failed**, 4,668 ms |             19 ms | Mixed  |
| Invalid `jsonrpc: "1.0"` rejection    |   **Failed**, 687 ms | **Failed**, 12 ms | Fail   |
| Both `result` and `error`             | **Failed**, 4,685 ms |             10 ms | Mixed  |
| Forced disconnect and reconnect       |             5,336 ms |             19 ms | Pass   |
| Late response after cancellation      |             2,831 ms |               N/A | Pass   |

All results reproduced identically in three runs.

## Passed behavior

The Java client initialized, listed all seven tools, and called `ping` over both transports.
A bounded delay completed successfully. A two-second delay exceeded the configured one-second
request timeout, and the same client completed the following `ping`.

The client accepted the first duplicate response and remained usable. Streamable HTTP rejected
responses missing `jsonrpc` or containing both `result` and `error`, and the same client recovered.
After an HTTP disconnect, the same client and a new client both completed `ping`. After a stdio
disconnect exited the child process, a newly initialized client completed `ping`.

For `response_after_cancellation`, the stdio request timed out, Failure Lab observed the
cancellation and emitted the late response, and the same Java client completed the following
`ping` in all three runs.

## Invalid JSON-RPC version acceptance

The Java SDK accepted a response declaring `jsonrpc: "1.0"` as a successful tool result over both
stdio and Streamable HTTP. The following `ping` also succeeded. This reproduced in all six runs.
The response should be rejected because MCP uses JSON-RPC 2.0.

## Stdio inbound processing after malformed responses

For a response missing `jsonrpc`, the stdio transport logged a Jackson construction error stating
that `jsonrpc` must not be empty. For a response containing both `result` and `error`, it logged
that MCP responses must contain only one of those fields. In both cases, the original call did not
receive the parsing failure and instead expired at the request timeout. A following `ping` on the
same client also timed out.

The same malformed responses were rejected over Streamable HTTP without making the client
unusable. This transport difference reproduced in every run.

These observations are recorded as compatibility failures. They should be reviewed with the Java
SDK maintainers before an upstream issue is opened; this report does not yet claim a confirmed
upstream defect.

## Scope

This check covers the synchronous Java client, stdio and modern Streamable HTTP, request timeouts,
malformed and duplicate responses, transport loss, cancellation, and immediate recovery. It does
not cover the asynchronous client API, legacy HTTP sessions, SSE, concurrency, authentication,
idle-session expiry, or soak behavior.
