# Security Policy

## Supported versions

MCP Failure Lab is under active development. Security fixes are provided for the latest published release only.

Older releases, historical commits, and unmerged branches are not supported.

## Reporting a vulnerability

Report suspected security vulnerabilities privately using [GitHub Private Vulnerability Reporting](https://github.com/anilloutombam/mcp-failure-lab/security/advisories/new).

Do not open a public issue, discussion, or pull request for an undisclosed vulnerability.

When reporting an issue, include where possible:

- Affected version, command, tool, or transport
- Steps to reproduce
- A minimal proof of concept
- Expected and observed behavior
- Security impact
- Required permissions or environment

Do not include real credentials, access tokens, personal data, or unrelated private protocol data. Use placeholders or isolated test credentials where possible.

## Response

Security reports will normally be acknowledged within seven days.

Fix and disclosure timelines depend on the severity and complexity of the issue. Please allow reasonable time for investigation and remediation before public disclosure.

When appropriate, fixes will be released in a new package version and documented through a GitHub Security Advisory.

## Testing boundaries

MCP Failure Lab intentionally introduces failure conditions such as delays, hangs, cancellations, and transport failures. These tests can disrupt the system being tested.

Only test systems you own or have explicit permission to assess.

Do not use MCP Failure Lab to:

- Disrupt third-party services without authorization
- Access data without authorization
- Collect or expose credentials or private data
- Generate uncontrolled or excessive traffic
- Circumvent access controls on systems you are not authorized to test

Prefer local, development, staging, or otherwise isolated environments.

Stop testing if it risks data loss, service disruption, credential exposure, or impact to other users.

## Non-security issues

For ordinary bugs and feature requests, use the [public issue tracker](https://github.com/anilloutombam/mcp-failure-lab/issues).

For community conduct concerns, see [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
