# Contributing to MCP Failure Lab

Thanks for your interest in contributing to MCP Failure Lab.

Contributions should keep failure behavior deterministic, MCP protocol behavior explicit, and tests safe and reproducible.

## Development setup

Requirements:

- Node.js 22.19.0 or newer
- npm

Install dependencies and verify the repository:

```bash
npm install
npm run format:check
npm run typecheck
npm test
npm run build
```

## Before you start

Keep pull requests focused on one feature, fix, refactor, or documentation change.

Open an issue before starting:

- New features
- Architectural changes
- New runtime dependencies
- Changes that affect multiple parts of the project

Small bug fixes and documentation corrections may be submitted directly.

For an existing issue, check that it is open and unassigned before starting substantial work. Comment with your intended approach and wait for assignment or maintainer confirmation.

Issues suitable for community contributions will normally have the `help wanted` or `good first issue` label.

## Engineering guidelines

### MCP protocol safety

- Never write logs or diagnostics to stdout while serving MCP over stdio. Stdout is reserved for protocol messages.
- Treat tool arguments, scenario definitions, and protocol data as untrusted input.
- Handle cancellation, timeouts, signals, transport closure, and cleanup explicitly.
- Bound user-controlled durations, retries, buffers, and resource usage.
- Do not leave timers, listeners, child processes, or connections running after a test finishes.

### Deterministic failures

Failure scenarios should have clear activation conditions and observable outcomes.

Avoid arbitrary sleeps in tests. Prefer observable events, injected clocks, test doubles, or other deterministic synchronization.

A failure should be reproducible without depending on timing luck or a particular machine.

### Keep changes maintainable

Reuse existing helpers before adding new abstractions. Avoid duplicating connection, cleanup, validation, or lifecycle behavior.

Keep responsibilities separated between CLI handling, server construction, tools, transports, scenario orchestration, and reporting.

Avoid unrelated refactoring or formatting changes in the same pull request.

## Testing

Behavior changes require appropriate test coverage.

Use:

- Unit tests for isolated validation, state, timing, and cancellation behavior
- Integration tests for MCP discovery, invocation, responses, and transports
- End-to-end tests when real CLI or process behavior is required

Regression fixes should include a test that fails without the fix.

Before requesting review, run:

```bash
npm run format
npm run typecheck
npm test
npm run build
```

## Documentation

Update documentation when a change affects:

- Commands or MCP tools
- Inputs, outputs, limits, or failure behavior
- Setup or operational behavior
- Public architecture or interfaces

Documentation should describe implemented behavior separately from planned capabilities.

## Branches and commits

Create branches from the latest `main` using a descriptive prefix:

```text
feat/transport-interruption
fix/cancellation-cleanup
test/session-loss-regression
docs/security-policy
```

Prefer Conventional Commits:

```text
feat: add deterministic transport interruption
fix: remove duplicate shutdown handlers
test: cover cancellation race
docs: update security policy
```

## Pull requests

Pull requests should explain:

- The problem or reason for the change
- What changed
- Tests performed
- Documentation changes
- Known limitations, if applicable

You are responsible for understanding and verifying everything you submit, including code produced with coding assistants.

Before requesting review, make sure automated checks pass, documentation matches the implementation, and no credentials, tokens, secrets, or machine-specific files are included.

## Security

Do not report suspected security vulnerabilities publicly.

Follow [`SECURITY.md`](./SECURITY.md) for private vulnerability reporting and responsible testing requirements.

## Code of Conduct

Contributors must follow [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## License

By submitting a contribution, you agree that it may be distributed under the project's MIT License and that you have the right to submit it.
