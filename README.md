# MCP Failure Lab

A chaos-engineering and resilience-testing toolkit for Model Context Protocol servers.

## Goal

MCP Failure Lab helps server authors reproduce transport failures, hanging tools, malformed responses, session loss, cancellation races, and other reliability problems in a deterministic way.

The project is being built incrementally, with an emphasis on protocol correctness, reproducible tests, explicit failure semantics, and clean operational behavior.

## Status

Early development.

The first working milestone includes:

- A TypeScript command-line application
- A `serve` command
- An MCP server factory
- MCP communication over stdio
- A discoverable `ping` tool
- A bounded, cancellation-aware `delay` fault tool
- A cancellation-aware `hang` fault tool
- A `disconnect` fault tool that interrupts the active transport
- Dependency-injected time for deterministic testing
- A code-first scenario model and in-process scenario runner
- Outcome and maximum-duration assertions for scenario recordings
- Unit coverage for the ping result
- Graceful `SIGINT` and `SIGTERM` handling
- Clean, reproducible build output
- Manual end-to-end verification with MCP Inspector

CLI-driven JSON scenarios and initial console and JSON reporting are available.
External client adapters, reusable reporter abstractions, and additional fault
types are not implemented yet.

## Architecture

### Current architecture

```mermaid
graph LR
    Host[MCP Host or Inspector] --> Transport[stdio Transport]
    Transport --> Host
    Transport --> Server[MCP Server]
    Server --> Transport
    Server --> Registration[Tool Registration]
    Registration --> Ping[ping]
    Registration --> Delay[delay]
    Registration --> Hang[hang]
    Registration --> Disconnect[disconnect]
    CLI[CLI serve command] --> Transport
    CLI --> Server
```

The current implementation has five responsibilities:

- **CLI** — parses commands and starts the server through `serve`.
- **Transport** — `StdioServerTransport` exchanges JSON-RPC messages over standard input and output.
- **Server factory** — `createServer` constructs and configures the MCP server without starting I/O.
- **Health tool** — `ping` returns a deterministic, testable health response.
- **Fault tools** — `delay`, `hang`, and `disconnect` reproduce timing, cancellation, and transport-loss behavior.

Server construction and server execution remain separate. This allows future transports and integration tests to reuse the same server configuration.

### Request flow

```text
MCP Host
  → stdio transport
  → MCP server
  → registered tool handler
  → response, pending request, or transport interruption
```

Diagnostics must never be written to stdout while the stdio transport is active because stdout carries MCP protocol messages. Operational diagnostics are written to stderr.

## Scenario execution

```mermaid
graph TD
    Scenario[TypeScript Scenario] --> Runner[Scenario Runner]
    Runner --> Client[MCP Client]
    Client --> Server[MCP Failure Lab Server]
    Server --> Fault[Registered Fault Tool]
    Fault --> Client
    Client --> Runner
    Runner --> Assertions[Assertion Engine]
    Assertions --> Recording[Scenario Recording]
```

The initial runner executes code-first TypeScript scenarios against MCP Failure
Lab through a real MCP client connection. It records the observed outcome and
duration, then evaluates declarative expectations. This validates failure
semantics in-process without introducing a proxy or a second fault implementation.

The runner does not yet orchestrate external MCP clients. Target-client adapters
are a separate future layer for verifying how a specific host reacts to the
controlled faulty server.

### Planned reporting and orchestration

```mermaid
graph TD
    CLI[CLI] --> Runner[Scenario Runner]
    Runner --> Adapter[Target Client Adapter]
    Runner --> Reporters[Reporters]
    Reporters --> ConsoleReport[Console Report]
    Reporters --> JsonReport[JSON Report]
    Reporters --> JunitReport[JUnit Report]
```

Planned capabilities include:

- Deterministic fault scenarios
- Response delays and hanging tools
- Transport interruption
- Malformed MCP messages
- Duplicate responses
- Session loss
- Cancellation testing
- Timeout assertions
- Reproduction metadata
- Console, JSON, and JUnit reports

The architecture will evolve incrementally. New abstractions will be introduced only when supported by a concrete requirement and corresponding tests.

## Requirements

- Node.js 22.19.0 or newer
- npm

## Installation

Run MCP Failure Lab without installing it:

```bash
npx mcp-failure-lab --help
```

Or install it globally:

```bash
npm install -g mcp-failure-lab
```

## Install for development

Clone the repository and install its dependencies:

```bash
git clone https://github.com/anilloutombam/mcp-failure-lab.git
cd mcp-failure-lab
npm install
```

## Usage

Display CLI help:

```bash
npm run dev -- --help
```

Display the current version:

```bash
npm run dev -- --version
```

Start the MCP server over stdio:

```bash
npm --silent run dev -- serve
```

The process waits silently for an MCP client. Press `Ctrl+C` to shut it down gracefully.

### Run a scenario

Scenario files use JSON. For example, `examples/scenarios/delay-success.json`
contains:

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

Run it against an in-memory MCP Failure Lab server:

```bash
npx mcp-failure-lab run examples/scenarios/delay-success.json
```

Use `--report json` for machine-readable output:

```bash
npx mcp-failure-lab run examples/scenarios/delay-success.json --report json
```

When JSON reporting is selected, input and execution failures also produce a
machine-readable report on stdout:

```json
{
  "passed": false,
  "error": {
    "code": "scenario_load_failed",
    "message": "Failed to run scenario: cannot read scenario file missing.json"
  }
}
```

Error codes are `invalid_arguments`, `scenario_load_failed`, and
`scenario_execution_failed`.

The command applies a 30-second timeout when `timeoutMs` is omitted. It exits with
status `0` when all expectations pass, `2` when scenario assertions fail, and `1`
when the scenario cannot be loaded or executed. This initial command runs
scenarios against MCP Failure Lab itself; external MCP client orchestration is
planned separately.

## Inspect the MCP server

Launch the official MCP Inspector:

```bash
npx @modelcontextprotocol/inspector npm --silent run dev -- serve
```

In the Inspector:

1. Connect using the stdio transport.
2. Open **Tools**.
3. List the available tools.
4. Select `ping`.
5. Run the tool.

A successful response resembles:

```json
{
  "status": "ok",
  "timestamp": "2026-07-31T16:32:47.570Z"
}
```

The `delay` tool accepts `delayMs` from `0` through `30000` and waits that long
before returning a successful response. This can be used to verify client timeout
and cancellation behavior without introducing nondeterministic latency.

The `hang` tool intentionally never returns a response. It remains pending until
the client cancels the request, allowing timeout and cancellation cleanup paths to
be tested without leaving work running on the server.

The `disconnect` tool closes the active MCP transport while its request is in
flight. The client receives a connection failure instead of a tool response, which
exercises transport-loss recovery behavior.

Do not share or commit the temporary authentication token included in the Inspector URL.

## Development commands

Format the repository:

```bash
npm run format
```

Check formatting without modifying files:

```bash
npm run format:check
```

Run TypeScript validation:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```

Create a clean production build:

```bash
npm run build
```

Run the compiled CLI:

```bash
npm run start -- --help
```

## Project structure

```text
mcp-failure-lab/
├── examples/
│   └── scenarios/
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── src/
│   ├── cli.ts
│   ├── delay.ts
│   ├── disconnect.ts
│   ├── hang.ts
│   ├── ping.ts
│   ├── runArguments.ts
│   ├── scenario.ts
│   ├── scenarioCommand.ts
│   └── server.ts
└── tests/
    ├── helpers/
    ├── integration/
    ├── unit/
    └── e2e/
```

Generated directories such as `dist/`, `coverage/`, and `node_modules/` are not committed.

## Testing strategy

The project separates tests by responsibility:

- **Unit tests** validate isolated domain behavior.
- **Integration tests** validate MCP client-server communication and transports.
- **End-to-end tests** will validate CLI-driven scenarios involving real processes.

Tests inject clocks and delay implementations where appropriate so assertions remain deterministic across machines, timezones, and test runs.

## Engineering principles

- Prefer small, explicit interfaces.
- Keep transport logic separate from tool behavior.
- Treat all protocol and scenario data as untrusted.
- Handle cancellation, timeouts, process signals, and cleanup explicitly.
- Avoid writing diagnostics to stdout during stdio operation.
- Introduce abstractions only after a concrete requirement appears.
- Add regression coverage for every bug fix.
- Keep commits focused and reviewable.

## Development workflow

Development happens through focused branches and pull requests:

```bash
git switch -c feat/example-change
```

Before opening a pull request, run:

```bash
npm run format:check
npm run typecheck
npm test
npm run build
```

The `main` branch should remain in a working, reviewable state.

## Roadmap

- [x] Initialize the TypeScript CLI
- [x] Add the MCP server factory
- [x] Add stdio transport
- [x] Add the deterministic `ping` tool
- [x] Validate the server with MCP Inspector
- [x] Add MCP client-server integration coverage
- [x] Define the code-first scenario model
- [x] Add the first response-delay fault
- [x] Add timeout and maximum-duration assertions
- [x] Add CLI scenario execution
- [ ] Add structured reports
- [x] Add CI
- [ ] Add target-client adapters
- [ ] Add Streamable HTTP support
- [x] Publish the first npm release

## License

MIT
