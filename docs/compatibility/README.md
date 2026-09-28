# External compatibility

Versioned reports in this directory record black-box checks of published MCP Failure Lab releases
against independent MCP clients. They complement the project's unit, integration, and end-to-end
tests; they are not a permanent compatibility guarantee for later client releases.

| Failure Lab release | Tested clients                                                                   | Report               |
| ------------------- | -------------------------------------------------------------------------------- | -------------------- |
| 0.11.0              | TypeScript 1.30.1, Python 2.2.0, Go 1.7.0, Rust 3.4.0, C# 2.2.0                  | [Report](v0.11.0.md) |
| 0.10.0              | TypeScript 1.30.0, Python 2.2.0, Go 1.7.0, Rust 3.4.0, C# 2.2.0                  | [Report](v0.10.0.md) |
| 0.9.0               | TypeScript 1.30.0, Python 2.2.0, Go 1.7.0, Rust 3.4.0, C# 2.2.0, Inspector 2.7.0 | [Report](v0.9.0.md)  |

Published-package tests against independent MCP projects are documented separately:

- [GitHub MCP Server 1.12.2](github-mcp-server-1.12.2.md) — hosted Streamable HTTP and local stdio
  authentication, tool allowlisting, repeated read-only calls, and lifecycle checks using
  `mcp-failure-lab@0.10.0`.
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

## Publishing data to MCP Failure Observatory

The normalized, machine-readable companion to these reports is stored at
[`data/observatory/compatibility-reports.json`](../../data/observatory/compatibility-reports.json).
It is the ingestion contract for MCP Failure Observatory; Markdown is not
scraped because report prose and tables are intentionally human-oriented.

When adding a supported compatibility report:

1. Add the report Markdown in this directory.
2. Add its normalized implementation, scenarios, runs, evidence summaries,
   and reviewed upstream links to the manifest.
3. Give every report, run alias, and Finding a stable identifier.
4. Run `npm run observatory:validate`.

Decision-layer experiments must not be added to this manifest because they do
not represent MCP implementation Test Runs.

After a manifest change reaches `main`, GitHub Actions validates it and can
send a `failure-lab-data-published` event to the Observatory. The raw manifest
remains available at a stable URL for scheduled fallback ingestion.

Repository maintainers can enable immediate delivery by adding an
`OBSERVATORY_DISPATCH_TOKEN` Actions secret. Use a fine-grained token scoped to
`anilloutombam/mcp-observatory` with **Contents: write** permission, which is
required by GitHub's repository-dispatch endpoint.
