# Security Policy

## Supported versions

MCP Failure Lab is in early development and has not published its first npm
prerelease. Security fixes currently target the latest commit on `main` only.
Older commits and unmerged branches are not supported.

This policy will be updated with a version-support table when releases begin.

## Report a vulnerability privately

Do not report suspected vulnerabilities in a public issue, discussion, pull
request, or social-media post.

Use GitHub's private vulnerability reporting form:

<https://github.com/anilloutombam/mcp-failure-lab/security/advisories/new>

Include, when available:

- The affected version, commit, command, tool, or transport.
- Reproduction steps or a minimal proof of concept.
- The expected and observed security impact.
- Required permissions and environmental conditions.
- Suggested mitigations or fixes.
- Whether the vulnerability has been disclosed elsewhere.

Remove real credentials, MCP Inspector tokens, personal data, and unrelated
private protocol content. Use placeholders or isolated test credentials in
proofs of concept.

## What to expect

The maintainer will aim to acknowledge a report within seven days. After initial
assessment, the reporter will receive a status update and may be asked for more
information. Resolution time depends on severity and complexity.

Please allow a reasonable remediation period before public disclosure. The
maintainer will coordinate disclosure and credit with the reporter when
practical. Reports made in good faith will not result in legal action from this
project for accidental, limited interaction needed to demonstrate the issue.

## Testing boundaries

Test only systems you own or are explicitly authorized to assess. Do not use MCP
Failure Lab to disrupt third-party services, access data without permission, or
generate uncontrolled load.

Keep demonstrations bounded and local. Stop testing if it could damage data,
affect availability, expose secrets, or impact other users.

## Non-security reports

Use the public bug-report form for ordinary defects without a confidentiality or
security impact. Use the process in [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
for community conduct concerns.
