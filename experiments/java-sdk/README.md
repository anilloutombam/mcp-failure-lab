# Java SDK compatibility experiment

This experiment exercises the official Java MCP SDK `2.0.1` against the
published `mcp-failure-lab@0.11.0` package. It does not execute the Failure Lab
source checkout.

The container combines Java 21, Maven 3.9.11, and Node.js 22. It downloads the
pinned npm package through `npx` and writes a machine-readable result file.

```bash
docker build -t mcp-failure-lab-java-sdk ./experiments/java-sdk
mkdir -p work/java-sdk-results
docker run --rm \
  -v "$PWD/work/java-sdk-results:/results" \
  mcp-failure-lab-java-sdk
```

The harness repeats each case three times over stdio and Streamable HTTP where
the fault is supported. Results are written to
`work/java-sdk-results/java-sdk-2.0.1-results.json`.
