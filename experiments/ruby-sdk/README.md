# Ruby SDK compatibility experiment

This experiment exercises the official Ruby MCP SDK `1.6.1` against the
published `mcp-failure-lab@0.12.0` package. It runs three independent repeats
over stdio and Streamable HTTP using the legacy `2025-11-25` lifecycle.

```bash
docker build -t mcp-failure-lab-ruby-sdk ./experiments/ruby-sdk
mkdir -p work/ruby-sdk-results
docker run --rm \
  -v "$PWD/work/ruby-sdk-results:/results" \
  mcp-failure-lab-ruby-sdk
```

Results are written to
`work/ruby-sdk-results/ruby-sdk-1.6.1-results.json`.
