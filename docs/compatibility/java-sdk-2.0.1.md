# Java SDK 2.0.1 compatibility

Test date: 2026-10-02

## Versions

| Component       | Version    |
| --------------- | ---------- |
| MCP Failure Lab | 0.11.0     |
| Java MCP SDK    | 2.0.1      |
| Protocol        | 2025-11-25 |
| Java            | 21.0.9     |
| Maven           | 3.9.11     |
| Node.js         | 22.23.3    |
| npm             | 10.9.9     |

The server was started from the published npm package, not from the repository checkout:

```text
npx -y mcp-failure-lab@0.11.0 serve
npx -y mcp-failure-lab@0.11.0 serve --transport http --host 127.0.0.1 --port 43123 --path /mcp
```

Package identity:

```text
integrity: sha512-NXwSIP6hwO29fQYiWNWWF7iVhJ3aTRLO1cxAr+UNteBAHHNSivK3hcpM/RqT7G3DmudxtHqt6lThbCJxcGmtyw==
sha1:      adee5052d9d30efd4774e703b875e1b22d7ce232
```

The test ran in a Linux arm64 container. The harness and pinned container images are in
[`experiments/java-sdk`](../../experiments/java-sdk/README.md).

## Procedure

Each case ran three times. The client used the synchronous Java SDK API.

- Normal requests had a five-second timeout.
- The timeout case called `delay` with `delayMs: 2000` and a one-second request timeout, then
  called `ping` on the same client.
- Malformed-response cases called `malformed_message`, then called `ping` on the same client.
- The duplicate-response case called `duplicate_response`, waited 100 ms, then called `ping`.
- The disconnect case attempted `ping` on the same client and on a new client.
- The cancellation case called `response_after_cancellation` with a one-second request timeout,
  waited 1.2 seconds, then called `ping` on the same client.

Durations are medians for the complete case, including initialization and cleanup.

## Results

| Case                                   | stdio           | Streamable HTTP |
| -------------------------------------- | --------------- | --------------- |
| Initialize, list tools, `ping`         | Pass — 692 ms   | Pass — 13 ms    |
| 250 ms delay                           | Pass — 916 ms   | Pass — 272 ms   |
| Timeout, then `ping`                   | Pass — 1,652 ms | Pass — 1,027 ms |
| Duplicate response, then `ping`        | Pass — 776 ms   | Pass — 126 ms   |
| Missing `jsonrpc`, then `ping`         | Fail — 4,668 ms | Pass — 19 ms    |
| `jsonrpc: "1.0"`, then `ping`          | Fail — 687 ms   | Fail — 12 ms    |
| Both `result` and `error`, then `ping` | Fail — 4,685 ms | Pass — 10 ms    |
| Disconnect and reconnect               | Pass — 5,336 ms | Pass — 19 ms    |
| Response after cancellation            | Pass — 2,831 ms | Not applicable  |

The status of every case was the same in all three runs.

## Observations

### Invalid JSON-RPC version

The SDK returned the `malformed_message` tool result when its response contained
`jsonrpc: "1.0"`. It did this over both transports. The following `ping` succeeded.

Expected: reject the response because its JSON-RPC version is not `2.0`.

### Missing `jsonrpc` over stdio

The stdio transport logged:

```text
Cannot construct instance of io.modelcontextprotocol.spec.McpSchema$JSONRPCResponse:
jsonrpc must not be empty
```

The tool call timed out. The following `ping` also timed out. Over Streamable HTTP, the tool call
failed and the following `ping` succeeded.

### Both `result` and `error` over stdio

The stdio transport logged:

```text
Cannot construct instance of io.modelcontextprotocol.spec.McpSchema$JSONRPCResponse:
MCP responses MUST either have a result or error
```

The tool call timed out. The following `ping` also timed out. Over Streamable HTTP, the tool call
failed and the following `ping` succeeded.

### Disconnect behavior

The stdio child exited after `disconnect`. The existing client could not recover; a new client
initialized and completed `ping`. Over Streamable HTTP, both the existing client and a new client
completed `ping` after the interrupted response.

### Cancellation behavior

The stdio call to `response_after_cancellation` reached the one-second request timeout. Failure
Lab sent the late response after receiving cancellation. The same client completed `ping` after
the late response in all three runs.

## Classification

- Accepting `jsonrpc: "1.0"`: failed protocol validation.
- Losing stdio request processing after the other two malformed responses: failed recovery.
- No upstream issues were opened as part of this test.

## Not tested

- Asynchronous Java client API
- Legacy HTTP and SSE
- Concurrent requests
- Authentication
- Idle-session expiry
- Soak behavior
