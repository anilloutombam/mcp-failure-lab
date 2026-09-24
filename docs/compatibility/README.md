# External compatibility

Versioned reports in this directory record black-box checks of published MCP Failure Lab releases
against independent MCP clients. They complement the project's unit, integration, and end-to-end
tests; they are not a permanent compatibility guarantee for later client releases.

| Failure Lab release | Tested clients                                                                   | Report               |
| ------------------- | -------------------------------------------------------------------------------- | -------------------- |
| 0.10.0              | TypeScript 1.30.0, Python 2.2.0, Go 1.7.0, Rust 3.4.0, C# 2.2.0                  | [Report](v0.10.0.md) |
| 0.9.0               | TypeScript 1.30.0, Python 2.2.0, Go 1.7.0, Rust 3.4.0, C# 2.2.0, Inspector 2.7.0 | [Report](v0.9.0.md)  |

Published-package tests against independent MCP projects are documented separately:

- [`tbxark/mcp-proxy` 1.1.0](tbxark-mcp-proxy-1.1.0.md) — two-server aggregation, delay,
  timeout, malformed and duplicate responses, downstream isolation, automatic reconnect, and
  lifecycle checks using `mcp-failure-lab@0.10.0`.
- [`punkpeye/mcp-proxy` 6.7.19](punkpeye-mcp-proxy-6.7.19.md) — stateful Streamable
  HTTP-to-stdio delay, timeout, malformed response, duplicate response, disconnect, recovery, and
  lifecycle checks using `mcp-failure-lab@0.10.0`.
- [`supercorp-ai/supergateway` 4.0.0](supergateway-4.0.0.md) — bidirectional Streamable HTTP/stdio
  bridging, delay, timeout/cancellation, malformed and duplicate responses, disconnect recovery,
  and lifecycle checks using `mcp-failure-lab@0.10.0`.
- [Official Everything server 2026.8.31](everything-server-2026.8.31.md) — stdio and Streamable
  HTTP baseline, bounded long-running work, timeout recovery, input-error isolation, and lifecycle
  checks using `mcp-failure-lab@0.10.0`.
- [`sparfenyuk/mcp-proxy` 0.12.0](mcp-proxy-0.12.0.md) — bidirectional transport, timeout,
  malformed-response, disconnect, recovery, and lifecycle checks using `mcp-failure-lab@0.10.0`.

Decision-layer experiments are documented separately because they evaluate how a downstream model
acts on failure evidence rather than whether an MCP client conforms to the protocol:

- [Jev 1.13 recovery-evidence A/B experiment](jev-1.13.md) — 20 runs per case using normalized
  evidence from `mcp-failure-lab@0.10.0`.

The public documentation provides a shorter [compatibility overview](https://mcplab.dev/docs/compatibility/).
