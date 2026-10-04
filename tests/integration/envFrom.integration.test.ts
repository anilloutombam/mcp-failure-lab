import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  McpTargetClientAdapter,
  McpTargetClientAdapterProvider,
} from "../../src/mcpTargetClientAdapter.js";
import { boundedTimeoutMs } from "../../src/targetClientAdapter.js";

afterEach(() => vi.unstubAllEnvs());

it("passes mapped and literal variables to a real stdio child without reporting secrets", async () => {
  const config = {
    transport: "stdio" as const,
    command: process.execPath,
    args: ["--import", "tsx", resolve("tests/fixtures/envFromStdioServer.ts")],
    env: { LAB_CHILD_TOKEN: "overridden", LAB_CHILD_MODE: "literal" },
    envFrom: { LAB_CHILD_TOKEN: "LAB_PARENT_TOKEN", LAB_CHILD_EMPTY: "LAB_PARENT_EMPTY" },
  };
  const target = new McpTargetClientAdapterProvider().resolve(config);
  // Resolution happens at transport creation, after configuration validation.
  vi.stubEnv("LAB_PARENT_TOKEN", "fixture-token");
  vi.stubEnv("LAB_PARENT_EMPTY", "");
  vi.stubEnv("LAB_UNMAPPED_SECRET", "unmapped-secret");
  const result = await target.run({
    name: "child environment",
    call: { tool: "check_environment", args: {} },
    timeoutMs: 2000,
    expect: {
      outcome: "success",
      result: { textContains: '"mapped":true,"literal":true,"empty":true,"unrelatedAbsent":true' },
    },
  });
  expect(result.passed).toBe(true);
  expect(JSON.stringify(result)).not.toContain("fixture-token");
  expect(JSON.stringify(result)).not.toContain("unmapped-secret");
  expect(config.env.LAB_CHILD_TOKEN).toBe("overridden");
});

it("does not connect or spawn when a source variable is missing", async () => {
  vi.stubEnv("LAB_MISSING_TOKEN", undefined);
  const client = { connect: vi.fn(), callTool: vi.fn(), close: vi.fn(async () => undefined) };
  const adapter = new McpTargetClientAdapter(undefined, undefined, () => client);
  const result = await adapter.setup({
    operationId: "setup",
    timeoutMs: boundedTimeoutMs(1000),
    config: { transport: "stdio", command: "never-spawn", envFrom: { TOKEN: "LAB_MISSING_TOKEN" } },
  });
  expect(result.outcome).toBe("error");
  expect(client.connect).not.toHaveBeenCalled();
  if (result.outcome !== "success")
    expect(result.failure.message).toBe(
      "environment variable LAB_MISSING_TOKEN is required for stdio variable TOKEN",
    );
});
