# MCP client timeout-recovery CI example

This example checks that an MCP client remains usable after one request exceeds its client-side
deadline. It launches the repository build of MCP Failure Lab over stdio, calls `delay` with a
deadline shorter than the requested delay, and then calls `ping` on the same connection.

From the repository root, run:

```sh
npm run build
npm run example:client-recovery
```

Expected output:

```text
timeout: observed
follow-up ping: passed
connection recovery: passed
```

## Adapt this for your client

The script uses the official TypeScript MCP client as a runnable reference. To test another MCP
client, keep the same sequence and assertions while replacing the client construction and calls:

1. Launch Failure Lab over stdio.
2. Call `delay` with `delayMs: 1000` and a shorter client deadline.
3. Require the client to report a timeout.
4. Call `ping` on the same connection and require a successful `status: "ok"` result.
5. Close the client and child process in every outcome.

In another repository, pin the published Failure Lab version in the stdio launch configuration:

```json
{
  "command": "npx",
  "args": ["-y", "mcp-failure-lab@0.13.2", "serve"]
}
```

Avoid exact elapsed-time assertions. CI machines vary; the useful contract is that the deadline is
observed and the same connection handles the follow-up request.
