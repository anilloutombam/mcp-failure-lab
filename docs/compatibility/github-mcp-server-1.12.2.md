# GitHub MCP Server 1.12.2 compatibility report

Tested on 2026-09-24 with the published MCP Failure Lab package.

## Versions

- GitHub MCP Server: `v1.12.2`
- Release commit: `85598ba6e1256f7ebf4867b95d63b833c4549264`
- Darwin arm64 archive SHA-256:
  `7e6c5aec43f26b82d3580e77a4ee26872bcd34b48c9a08d0eaef48b5d0563904`
- Hosted endpoint: `https://api.githubcopilot.com/mcp/`; service version not disclosed
- MCP Failure Lab: npm `latest` = `0.10.0`
- npm integrity:
  `sha512-9BLArjh99frHkXjFNt4A3wgI1r7MxUz9bsVlSjmLfGR25uPXPkmfR6tupwDnywcUSIR3SREimPbYKDgUnYg5iw==`
- Node.js: `26.5.0`
- Platform: macOS 26.6.2 arm64

## Commands

Hosted Streamable HTTP:

```bash
export GITHUB_MCP_AUTHORIZATION="Bearer $(gh auth token)"
npx --yes --package mcp-failure-lab@0.10.0 mcp-failure-lab run \
  examples/scenarios/github-get-me.json \
  --target examples/targets/github-http.json \
  --report json
unset GITHUB_MCP_AUTHORIZATION
```

Local stdio release:

```bash
gh release download v1.12.2 --repo github/github-mcp-server \
  --pattern 'github-mcp-server_Darwin_arm64.tar.gz'
shasum -a 256 github-mcp-server_Darwin_arm64.tar.gz
tar -xzf github-mcp-server_Darwin_arm64.tar.gz
./github-mcp-server --version
```

The local server was started with `stdio --read-only --tools=get_me`. The GitHub CLI token was
provided at process launch and was not written to the target file or report.

## Results

| Scenario                                  | Result                              |
| ----------------------------------------- | ----------------------------------- |
| Hosted authenticated `get_me`, run 1      | Pass, 1,049.35 ms                   |
| Hosted authenticated `get_me`, run 2      | Pass, 966.47 ms                     |
| Hosted authenticated `get_me`, run 3      | Pass, 846.11 ms                     |
| Hosted authenticated `get_me`, run 4      | Pass, 993.68 ms                     |
| Hosted request without authorization      | Rejected during setup               |
| Hosted request with invalid authorization | Rejected during setup               |
| Tool excluded by `X-MCP-Tools`            | Rejected as unknown; cleanup passed |
| Local stdio `get_me`, run 1               | Pass, 533.05 ms; cleanup passed     |
| Local stdio `get_me`, run 2               | Pass, 514.52 ms; cleanup passed     |
| Local stdio `get_me`, run 3               | Pass, 574.59 ms; cleanup passed     |

The hosted endpoint reported a missing authorization header when none was supplied and a malformed
authorization header for the invalid credential. No credential value appeared in the output.

## Finding

No GitHub MCP Server defect was reproduced.

The Failure Lab stdio target accepts literal environment values but has no equivalent of HTTP
`headerEnv` for resolving a secret from the parent environment. The local test therefore used a
shell launch helper. This is a Failure Lab configuration limitation, not a GitHub MCP Server bug.
It is tracked in [mcp-failure-lab#90](https://github.com/anilloutombam/mcp-failure-lab/issues/90).

## Not tested

Write tools, OAuth completion, GitHub Enterprise, server HTTP mode, network interruption, rate
limits, concurrency, and soak behavior. The server does not expose Failure Lab fault tools, so
delay, malformed-response, duplicate-response, and forced-disconnect scenarios were not run.
