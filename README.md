# MCP Failure Lab

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://mcplab.dev/brand/mcp-failure-lab-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://mcplab.dev/brand/mcp-failure-lab-logo-light.svg">
    <img src="https://mcplab.dev/brand/mcp-failure-lab-logo-light.svg" alt="MCP Failure Lab — Break it here. Trust it everywhere." width="720">
  </picture>
</p>

[![npm version](https://img.shields.io/npm/v/mcp-failure-lab)](https://www.npmjs.com/package/mcp-failure-lab)
[![CI](https://github.com/anilloutombam/mcp-failure-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/anilloutombam/mcp-failure-lab/actions/workflows/ci.yml)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-Official-blue)](https://registry.modelcontextprotocol.io/)
[![GitHub MCP Registry](https://img.shields.io/badge/GitHub_MCP_Registry-Listed-181717?logo=github)](https://github.com/mcp/anilloutombam/mcp-failure-lab)

A chaos-engineering and resilience-testing toolkit for Model Context Protocol servers.

[Documentation](https://mcplab.dev/docs/) ·
[Project page](https://mcplab.dev/failure)

![MCP Failure Lab demonstrating a bounded delay and an expected timeout](docs/demo.gif)

## Quick start

Run a real deterministic delay scenario without cloning the repository or installing the package globally:

```bash
npx mcp-failure-lab demo
```

Example output:

```text
MCP Failure Lab — Demo
Running a real 500ms delay scenario...

Scenario: Deterministic delay demo
Outcome: success
Duration: ~500 ms
Assertions: passed
```

The exact duration may vary slightly between runs. No API key or external MCP server is required.

Display the available commands:

```bash
npx mcp-failure-lab --help
```

Start the built-in MCP server over stdio:

```bash
npx mcp-failure-lab serve
```

Or start a local Streamable HTTP endpoint:

```bash
npx mcp-failure-lab serve --transport http
```

## Purpose

MCP Failure Lab helps server authors reproduce delays, hanging tools, cancellation, and transport loss in a deterministic way.

It provides controlled failure behavior for testing timeout handling, cancellation cleanup, transport-loss recovery, assertions, and CI outcomes.

## Current scope

MCP Failure Lab runs deterministic JSON scenarios against its built-in server or a configured
external HTTP or stdio MCP target from the command line.

Available now:

- `ping`, `delay`, `hang`, and `disconnect` tools
- MCP communication over stdio and Streamable HTTP
- Code-first and JSON scenario definitions
- Outcome and maximum-duration assertions
- MCP result assertions
- Sequential observer calls for post-condition verification
- External MCP target orchestration through a validated adapter registry
- Streamable HTTP and stdio target configurations
- Bounded adapter setup, execution, observation, cancellation, and cleanup
- Separate scenario-assertion and adapter-lifecycle diagnostics
- Console and JSON reporting
- Machine-readable command errors
- CI-friendly exit codes
- Unit, integration, and end-to-end tests

Not implemented:

- Provider-specific adapters and recovery policies
- JUnit reporting
- Malformed-message, duplicate-response, and session-loss faults

MCP Failure Lab is not a general-purpose proxy. External targets are exercised through the same
scenario calls and expectations as the built-in server.

## Run against another MCP server

Pass a target configuration to execute the same scenario against a Streamable HTTP or stdio MCP
server:

```bash
npm run dev -- run path/to/scenario.json --target path/to/target.json
```

See the [external MCP targets guide](https://mcplab.dev/docs/external-targets/) for complete HTTP
and stdio configuration, GitLab and Stripe integration guidance, browser-based MCP Inspector
validation, lifecycle diagnostics, credential handling, and troubleshooting.

The repository also includes a safe, read-only GitHub MCP example using the official remote server:

```bash
export GITHUB_MCP_AUTHORIZATION="Bearer your-token"
npm run dev -- run examples/scenarios/github-get-me.json \
  --target examples/targets/github-http.json
```

GitLab is available through its OAuth-capable stdio bridge:

```bash
npm run dev -- run examples/scenarios/gitlab-search-projects.json \
  --target examples/targets/gitlab-stdio.json
```

The first connection can open a browser for GitLab authorization. See the external-target guide
for prerequisites and the difference between GitLab OAuth and GitHub token authentication.

## Target-client adapter contract

The generic adapter contract drives external-target orchestration, and the deterministic test
adapter verifies its lifecycle without external I/O. See the
[architecture documentation](https://mcplab.dev/docs/architecture/#target-client-adapter-boundary)
for lifecycle, ownership, timeout, and observation details.

## How it works

MCP Failure Lab runs deterministic scenarios through its built-in MCP client and server or through
a configured external HTTP or stdio target. A scenario invokes a tool, records the observed outcome
and duration, and evaluates the declared expectations. Built-in scenarios use `ping`, `delay`,
`hang`, or `disconnect`; external scenarios use tools exposed by their target server.

Optional observer calls run sequentially on the same MCP client connection to verify post-conditions through a separate tool path.

See the [architecture documentation](https://mcplab.dev/docs/architecture/) for diagrams, responsibilities, and implementation boundaries.

## Documentation

Full guides and references are available at [mcplab.dev/docs](https://mcplab.dev/docs/).

- [Getting started](https://mcplab.dev/docs/getting-started/)
- [Scenarios](https://mcplab.dev/docs/scenarios/)
- [External MCP targets](https://mcplab.dev/docs/external-targets/)
- [Fault tools](https://mcplab.dev/docs/fault-tools/)
- [CLI reference](https://mcplab.dev/docs/cli/)
- [Reporting](https://mcplab.dev/docs/reporting/)
- [Architecture](https://mcplab.dev/docs/architecture/)
- [Examples](https://mcplab.dev/docs/examples/)
- [Troubleshooting](https://mcplab.dev/docs/troubleshooting/)

## Requirements

- Node.js 22.19.0 or newer
- npm

## Protocol compatibility

MCP Failure Lab targets MCP `2026-07-28` and accepts the `2025-11-25` initialization flow for
compatibility. See [Streamable HTTP](https://mcplab.dev/docs/streamable-http/) for protocol and
session details.

## Installation

Run the package directly with `npx`:

```bash
npx mcp-failure-lab demo
```

No global installation is required.

To install the command globally:

```bash
npm install -g mcp-failure-lab
```

## CLI

```bash
# Run the built-in demonstration
npx mcp-failure-lab demo

# Display command help
npx mcp-failure-lab --help

# Display the installed version
npx mcp-failure-lab --version

# Start the MCP server over stdio
npx mcp-failure-lab serve

# Start Streamable HTTP with local-safe defaults
npx mcp-failure-lab serve --transport http

# Override the HTTP endpoint explicitly
npx mcp-failure-lab serve --transport http --host localhost --port 4000 --path /mcp
```

The `serve` process waits for an MCP client. Press `Ctrl+C` to shut it down gracefully.

Streamable HTTP listens on `http://127.0.0.1:3000/mcp` by default. The server validates
the request path plus `Host` and `Origin` headers. Binding another host is an explicit
choice; this mode does not provide authentication or TLS, so do not expose it to an
untrusted network. Put authentication and TLS termination in a trusted front end if
remote access is required.

## Run a scenario

Scenario files use JSON:

```json
{
  "name": "bounded delay succeeds",
  "call": {
    "tool": "delay",
    "args": {
      "delayMs": 250
    }
  },
  "timeoutMs": 1000,
  "expect": {
    "outcome": "success",
    "maxDurationMs": 500
  }
}
```

From a repository checkout, run the included scenario:

```bash
npm run dev -- run examples/scenarios/delay-success.json
```

Generate machine-readable output:

```bash
npm run dev -- run examples/scenarios/delay-success.json --report json
```

The command exits with:

| Code | Meaning                                      |
| ---: | -------------------------------------------- |
|  `0` | All expectations passed                      |
|  `1` | The scenario could not be loaded or executed |
|  `2` | One or more assertions failed                |

For result assertions, observer calls, reporting formats, and timeout behavior, see the [scenario](https://mcplab.dev/docs/scenarios/) and [reporting](https://mcplab.dev/docs/reporting/) documentation.

## Fault tools

| Tool         | Behavior                                                     |
| ------------ | ------------------------------------------------------------ |
| `ping`       | Returns a deterministic health response                      |
| `delay`      | Waits for a bounded duration before returning                |
| `hang`       | Remains pending until the client cancels                     |
| `disconnect` | Interrupts the active transport while a request is in flight |

See the [fault tools reference](https://mcplab.dev/docs/fault-tools/) for arguments and behavior.

## Inspect the server

Launch the official MCP Inspector web UI against the published package:

```bash
npx @modelcontextprotocol/inspector npx mcp-failure-lab serve
```

See [External MCP targets](https://mcplab.dev/docs/external-targets/#validate-the-connection-in-a-browser)
for the complete browser-testing workflow and credential guidance.

## External integration validation

See the [Future AGI example](https://mcplab.dev/docs/examples/#future-agi-experiment) for an
independent Python-client validation of the `hang` fault. It is an external validation example,
not an official integration or endorsement.

## Development

Clone the repository and install its dependencies:

```bash
git clone https://github.com/anilloutombam/mcp-failure-lab.git
cd mcp-failure-lab
npm install
```

Run the development CLI:

```bash
npm run dev -- --help
```

Before opening a pull request, run:

```bash
npm run format:check
npm run typecheck
npm test
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## Roadmap

Planned work is tracked in [GitHub Issues](https://github.com/anilloutombam/mcp-failure-lab/issues).

Roadmap items are not part of the current implementation unless explicitly documented as available.

## License

[MIT](LICENSE)
