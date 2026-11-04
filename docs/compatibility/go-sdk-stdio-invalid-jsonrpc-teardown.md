# Go MCP SDK stdio connection teardown after invalid JSON-RPC responses

Test date: 2026-11-04

- [Raw results](go-sdk-stdio-invalid-jsonrpc-teardown-results.json)
- MCP Failure Lab: `0.13.2`
- Go: `1.27.1`
- Node.js: `22.23.4`
- Transport: stdio

## Question

The [0.13.2 compatibility report](v0.13.2.md) showed that a Go MCP SDK client
could not complete a follow-up `ping` after receiving a response with a missing
or invalid `jsonrpc` field over stdio. A failed follow-up call alone did not
establish whether the SDK terminated its owned transport process or only marked
the client session unusable. It also did not show how another request already
in flight would settle.

This follow-up checked both points against:

- Go MCP SDK `v1.8.0`;
- Go MCP SDK `main` at `f91620f5289e`.

## Method

Each case used a fresh `CommandTransport` and client session. The harness:

1. started `delay` with `delayMs: 750` and a 2.5-second client timeout;
2. waited 100 ms so the delay call was in flight;
3. called `malformed_message` with either `missing-jsonrpc` or
   `invalid-jsonrpc-version`;
4. waited 50 ms, then checked the owned child process using both signal `0` and
   `exec.Cmd.ProcessState`;
5. recorded how the in-flight delay call settled;
6. called `ping` on the same session.

Both variants ran three times per SDK revision, producing six executions per
revision.

## Results

| SDK revision            | Primary response | Child after primary   | In-flight delay | Follow-up `ping` |
| ----------------------- | ---------------- | --------------------- | --------------- | ---------------- |
| `v1.8.0`                | Rejected 6/6     | Exited and reaped 6/6 | Error 6/6       | Error 6/6        |
| `main` (`f91620f5289e`) | Rejected 6/6     | Exited and reaped 6/6 | Error 6/6       | Error 6/6        |

The in-flight delay call did not hang. It failed after approximately 102–103 ms
with the same invalid-version or connection error associated with the malformed
response. The later `ping` failed immediately.

For both SDK revisions, the child process was no longer alive and
`exec.Cmd.ProcessState` was populated when checked 50 ms after the primary
error. This distinguishes the result from a client object that merely rejects
new calls while leaving the owned stdio child running.

## Interpretation

The observed behavior is connection-wide:

- the malformed response is rejected;
- the owned stdio child exits and is reaped;
- another request already in flight fails promptly;
- later calls cannot reuse the session.

This report records behavior, not a protocol-conformance failure. MCP requires
valid JSON-RPC messages but does not define a recovery policy for a client that
receives an invalid response. Whether connection-wide teardown is intended is
an SDK policy question.

Go SDK issue
[#1209](https://github.com/modelcontextprotocol/go-sdk/issues/1209) is related
but covers malformed input reaching a Go SDK server. Issue
[#976](https://github.com/modelcontextprotocol/go-sdk/issues/976) and PR
[#1000](https://github.com/modelcontextprotocol/go-sdk/pull/1000) also concern
server-side request handling. They do not establish the intended behavior for
this client-side response path.

No upstream issue or discussion was created as part of this follow-up.

## Limitations

- The harness checked child liveness and reaping state but did not separately
  timestamp a stdout EOF event.
- Only two invalid JSON-RPC version-field variants were exercised.
- Only the Go SDK stdio transport was included in this diagnostic.
- Results from an automated compatibility harness do not establish production
  impact.
