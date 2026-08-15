import { describe, expect, it, vi } from "vitest";

import { runScenario, type MonotonicClock, type Scenario } from "../../src/scenario.js";
import { createServer } from "../../src/server.js";
import { connectTestClient } from "../helpers/mcpTestClient.js";

function clockReturning(...values: number[]): MonotonicClock {
  const now = vi.fn();
  values.forEach((value) => now.mockReturnValueOnce(value));
  return { now };
}

describe("scenario runner MCP integration", () => {
  it("records a successful tool call and evaluates its expectations", async () => {
    const server = createServer(undefined, { wait: async () => undefined });
    const connection = await connectTestClient(server);
    const scenario: Scenario = {
      name: "bounded delay succeeds",
      call: { tool: "delay", args: { delayMs: 250 } },
      expect: { outcome: "success", maxDurationMs: 25 },
    };

    try {
      const recording = await runScenario(connection.client, scenario, clockReturning(100, 120));

      expect(recording).toMatchObject({
        name: scenario.name,
        outcome: "success",
        durationMs: 20,
        passed: true,
        failures: [],
      });
    } finally {
      await connection.close();
    }
  });

  it("records an SDK request timeout as a timeout outcome", async () => {
    const server = createServer();
    const connection = await connectTestClient(server);
    const scenario: Scenario = {
      name: "delay exceeds the client timeout",
      call: { tool: "delay", args: { delayMs: 100 } },
      timeoutMs: 10,
      expect: { outcome: "timeout", maxDurationMs: 50 },
    };

    try {
      const recording = await runScenario(connection.client, scenario, clockReturning(100, 125));

      expect(recording).toMatchObject({
        name: scenario.name,
        outcome: "timeout",
        durationMs: 25,
        passed: true,
        failures: [],
      });
    } finally {
      await connection.close();
    }
  });
});
