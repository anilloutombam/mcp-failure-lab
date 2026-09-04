import { describe, expect, it } from "vitest";
import { startHttpServer } from "../../src/httpServer.js";
import { McpTargetClientAdapter } from "../../src/mcpTargetClientAdapter.js";
import { boundedTimeoutMs } from "../../src/targetClientAdapter.js";

async function connectedAdapter() {
  const server = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
  const adapter = new McpTargetClientAdapter();
  const setup = await adapter.setup({
    operationId: "setup",
    config: { transport: "http", url: server.url.toString() },
    timeoutMs: boundedTimeoutMs(1_000),
  });
  if (setup.outcome !== "success") {
    await server.close();
    throw new Error(`adapter setup failed: ${setup.failure.message}`);
  }
  return { server, session: setup.value };
}

describe("MCP target-client adapter integration", () => {
  it("executes, observes, cancels, and cleans up an HTTP session", async () => {
    const { server, session } = await connectedAdapter();
    try {
      const execution = await session.execute({
        operationId: "execute",
        scenario: { tool: "ping", args: {} },
        timeoutMs: boundedTimeoutMs(1_000),
      });
      const observation = await session.observe({
        operationId: "observe",
        observation: { tool: "ping", args: {} },
        timeoutMs: boundedTimeoutMs(1_000),
      });
      const cancellation = await session.cancel({
        operationId: "cancel",
        timeoutMs: boundedTimeoutMs(1_000),
      });
      const firstCleanup = await session.cleanup({
        operationId: "cleanup",
        timeoutMs: boundedTimeoutMs(1_000),
      });
      const secondCleanup = await session.cleanup({
        operationId: "cleanup-again",
        timeoutMs: boundedTimeoutMs(1_000),
      });

      expect(execution).toMatchObject({ operation: "execute", outcome: "success" });
      expect(observation).toMatchObject({ operation: "observe", outcome: "success" });
      expect(cancellation).toMatchObject({ operation: "cancel", outcome: "success" });
      expect(firstCleanup).toMatchObject({ operation: "cleanup", outcome: "success" });
      expect(secondCleanup).toBe(firstCleanup);
    } finally {
      await server.close();
    }
  });

  it("classifies an MCP request deadline as a timeout", async () => {
    const { server, session } = await connectedAdapter();
    try {
      const execution = await session.execute({
        operationId: "execute-timeout",
        scenario: { tool: "hang", args: {} },
        timeoutMs: boundedTimeoutMs(10),
      });

      expect(execution).toMatchObject({ operation: "execute", outcome: "timeout" });
    } finally {
      await session.cleanup({
        operationId: "cleanup",
        timeoutMs: boundedTimeoutMs(1_000),
      });
      await server.close();
    }
  });

  it("returns a setup observation when the target cannot be reached", async () => {
    const setup = await new McpTargetClientAdapter().setup({
      operationId: "setup-unreachable",
      config: { transport: "http", url: "http://127.0.0.1:1/mcp" },
      timeoutMs: boundedTimeoutMs(100),
    });

    expect(setup).toMatchObject({ operation: "setup", outcome: "error" });
  });
});
