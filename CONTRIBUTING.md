# Contributing to MCP Failure Lab

Thank you for helping make MCP implementations more reliable. Contributions
should keep failures deterministic, protocol behavior explicit, and test runs
safe and reproducible.

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

## Choose a focused change

Keep each pull request limited to one feature, fix, or refactor. Before adding a
new abstraction, connect it to a concrete scenario and corresponding tests.

For roadmap work, implement fault primitives before orchestration and reporting:

1. Fault behavior
2. Deterministic tests
3. Scenario-runner integration
4. Assertions and reproduction metadata
5. Reports

Open an issue before making a large architectural change or introducing a new
runtime dependency.

## Working on issues

Issues available for community contributions will normally have the
`help wanted` or `good first issue` label.

Before starting substantial work:

1. Confirm that the issue is open and unassigned.
2. Comment with a short explanation of your intended approach.
3. Ask a maintainer to assign the issue to you.
4. Wait for confirmation before beginning the implementation.

External contributors cannot assign issues to themselves. A maintainer will
assign an issue after confirming that it is ready and that the proposed approach
fits the project. Do not open a competing pull request for assigned work unless
the assignee or a maintainer approves collaboration.

Post a progress update if the work takes longer than expected. After 14 days
without an update, a maintainer may remove the assignment so another contributor
can work on it. You may ask for more time before then.

For work without an existing issue, open one and discuss the proposal before
starting a large feature, dependency, or architectural change. Small typo and
documentation corrections may be submitted directly.

## Community expectations

- Be respectful, constructive, and patient in issues and reviews.
- Keep technical disagreement focused on the change, not the contributor.
- Assume good intent, but support claims with code, tests, or documentation.
- Do not pressure maintainers or repeatedly request immediate reviews.
- Harassment, discrimination, spam, and abusive behavior are not accepted.

## Engineering rules

### Preserve MCP protocol safety

- Never write logs or diagnostics to stdout while serving MCP over stdio. Stdout
  is reserved for protocol messages; use stderr for operational diagnostics.
- Treat tool arguments, scenario definitions, and protocol data as untrusted.
  Validate inputs at the boundary.
- Handle cancellation, timeouts, signals, transport closure, and cleanup
  explicitly.
- Bound durations, retries, buffers, and other user-controlled resource usage.
- Do not allow a fault scenario to leave timers, listeners, processes, or
  connections running after a test finishes.

### Keep behavior deterministic

- Inject clocks, sleepers, randomness, process control, and transport operations
  when tests need to control them.
- Do not use arbitrary sleeps in tests. Synchronize on observable events or use
  injected test doubles.
- Every failure must have clear activation conditions and an observable outcome.
- Include enough information to reproduce failures without relying on timing
  luck or a particular machine.

### Avoid repeated code

- Search for an existing helper or abstraction before adding one.
- Reuse shared MCP connection and cleanup helpers in integration tests.
- Extract common behavior only when at least two real call sites need it; avoid
  speculative frameworks.
- Keep fault-specific behavior isolated. Shared registration, validation, and
  lifecycle logic should have one source of truth.
- Do not copy tests merely to vary input. Use focused cases or table-driven tests
  when the setup and assertions are the same.

### Keep responsibilities separate

- CLI code parses commands and manages process lifecycle.
- Server construction registers MCP capabilities without starting I/O.
- Tool modules own tool validation and behavior.
- Transports own message delivery and connection lifecycle.
- Scenario orchestration and reporting must not be embedded in individual tools.

## Testing requirements

Every behavior change requires test coverage at the lowest useful level:

- **Unit tests** for isolated validation, state, timing, and cancellation logic.
- **Integration tests** for MCP discovery, invocation, responses, and transport
  behavior.
- **End-to-end tests** only when real CLI or process behavior is required.

Regression fixes must include a test that fails without the fix. Tests must clean
up clients, servers, timers, listeners, and child processes in `finally` blocks
or shared lifecycle helpers.

Before requesting review, run:

```bash
npm run format
npm run typecheck
npm test
npm run build
```

Do not merge with skipped tests, focused test markers, formatting failures,
TypeScript errors, or unreviewed generated output.

## Documentation requirements

Update `README.md` in the same pull request when a change affects:

- Available commands or MCP tools
- Inputs, limits, outputs, or failure semantics
- Current or planned architecture
- Setup, inspection, or operational behavior

Architecture diagrams and responsibility lists must match the implemented server
surface. Document what exists today separately from planned capabilities.

## Branches and commits

Create branches from the latest `main` using a descriptive prefix:

- `feat/transport-interruption`
- `fix/cancellation-cleanup`
- `test/session-loss-regression`
- `docs/scenario-format`

Use concise imperative commit messages, preferably following Conventional
Commits:

```text
feat: add deterministic transport interruption
fix: remove duplicate shutdown handlers
test: cover cancellation race
docs: update fault tool architecture
```

Do not mix unrelated formatting or refactoring with a behavior change.

By submitting a contribution, you agree that it may be distributed under the
project's MIT License and that you have the right to submit it.

## Pull requests

A pull request description should explain:

- The problem and intended behavior
- The implementation approach
- Tests and verification performed
- Documentation changes
- Known limitations or follow-up work

Write the description in your own words, even if an AI coding assistant helped
with the implementation. Do not paste an AI-generated summary without reviewing
and rewriting it. You are responsible for understanding the change, verifying
every claim in the description, and explaining the design decisions to reviewers.

Before merging, confirm that:

- The branch is current with `main` and has no conflicts.
- Automated checks pass.
- New behavior has appropriate tests.
- The README reflects the implemented architecture and behavior.
- No secrets, Inspector tokens, credentials, or machine-specific files are
  included.
- The author understands the submitted code and described it in their own words.
- All actionable review comments are resolved.

Maintainers may close pull requests that ignore the contribution process, remain
inactive after follow-up, duplicate existing work, or do not align with the
project roadmap. Closing a pull request is not a judgment of the contributor.

## CodeRabbit reviews

CodeRabbit is configured through `.coderabbit.yaml`. Automatic review may be
unavailable for repositories below CodeRabbit's eligibility threshold. When a
review is not started automatically, comment on the pull request:

```text
@coderabbitai review
```

Request a complete re-review after significant changes with:

```text
@coderabbitai full review
```

Evaluate each suggestion against the code and project rules. Apply valid
findings, explain rejected findings in the discussion, and resolve the thread
only after the code and documentation are consistent.

## Security and responsible testing

Do not report suspected security vulnerabilities in a public issue. Use GitHub's
private vulnerability reporting feature when it is available, or contact the
repository owner privately.

Run fault scenarios only against systems you own or are authorized to test. Do
not include production credentials, private protocol transcripts, or temporary
MCP Inspector authentication tokens in issues, tests, fixtures, commits, or pull
requests.

Faults must default to bounded, local behavior. Any future capability that can
terminate external processes, interrupt remote services, or generate substantial
load requires explicit targeting and safeguards.
