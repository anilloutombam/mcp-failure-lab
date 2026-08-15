## Summary

<!--
What does this pull request change? Keep this concise and write it in your own
words, even if an AI coding assistant helped with the implementation.
-->

## Problem

<!-- What problem, failure mode, or requirement does this address? -->

## Implementation

<!-- Explain the approach and important design decisions. -->

## Behavior and failure semantics

<!--
Describe activation conditions and observable outcomes. For fault scenarios,
include limits, cancellation behavior, cleanup, and reproduction details.
Write "Not applicable" when this change has no runtime behavior.
-->

## Verification

<!-- List the tests and manual checks performed. -->

- [ ] Unit tests added or updated
- [ ] Integration tests added or updated
- [ ] Regression test added for a bug fix
- [ ] Manual verification described, if applicable

Commands run:

```text
npm run format:check
npm run typecheck
npm test
npm run build
```

## Documentation

<!-- List documentation changes or explain why none are required. -->

- [ ] README reflects affected commands, tools, behavior, and limits
- [ ] Architecture diagrams and responsibility lists match the implementation
- [ ] CONTRIBUTING.md updated if the contributor workflow changed
- [ ] No documentation change required

## Risks and limitations

<!-- Note compatibility concerns, cleanup risks, known limitations, and follow-up work. -->

## Final checklist

- [ ] This pull request contains one focused change
- [ ] The branch is current with `main` and has no conflicts
- [ ] Inputs and protocol data are validated at their boundaries
- [ ] Cancellation, timeouts, signals, and cleanup are handled where applicable
- [ ] Tests are deterministic and do not rely on arbitrary sleeps
- [ ] Shared helpers are reused; equivalent setup or behavior is not duplicated
- [ ] I understand the submitted code and described the change in my own words
- [ ] Stdout remains reserved for MCP protocol messages during stdio operation
- [ ] No secrets, credentials, Inspector tokens, or machine-specific files are included
- [ ] Formatting, type checks, tests, and the production build pass
- [ ] All actionable review comments are resolved

## Reviewer notes

<!-- Point reviewers to the most important files, decisions, or open questions. -->
