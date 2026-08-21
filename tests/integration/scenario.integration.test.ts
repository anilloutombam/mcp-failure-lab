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
      expect: {
        outcome: "success",
        maxDurationMs: 25,
        result: { isError: false, textContains: '"status":"delayed"' },
      },
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

describe("scenario runner recording", () => {
  const scenario: Scenario = {
    name: "record tool outcome",
    call: { tool: "example", args: {} },
    expect: { outcome: "error" },
  };

  it("classifies MCP tool error results", async () => {
    const client = {
      callTool: vi.fn(async () => ({
        content: [{ type: "text" as const, text: "tool failed" }],
        isError: true,
      })),
    };

    const recording = await runScenario(client, scenario, clockReturning(10, 15));

    expect(recording).toMatchObject({
      outcome: "error",
      durationMs: 5,
      passed: true,
      failures: [],
    });
  });

  it("classifies non-timeout exceptions as errors", async () => {
    const connectionError = new Error("connection closed");
    const client = {
      callTool: vi.fn(async () => {
        throw connectionError;
      }),
    };

    const recording = await runScenario(client, scenario, clockReturning(20, 25));

    expect(recording).toMatchObject({
      outcome: "error",
      durationMs: 5,
      passed: true,
      failures: [],
      error: connectionError,
    });
  });

  it("records outcome and maximum-duration assertion failures", async () => {
    const client = {
      callTool: vi.fn(async () => ({
        content: [{ type: "text" as const, text: "completed" }],
      })),
    };
    const mismatchedScenario: Scenario = {
      ...scenario,
      expect: { outcome: "timeout", maxDurationMs: 10 },
    };

    const recording = await runScenario(client, mismatchedScenario, clockReturning(100, 125));

    expect(recording).toMatchObject({
      outcome: "success",
      durationMs: 25,
      passed: false,
      failures: [
        "expected outcome timeout, received success",
        "expected duration at most 10ms, received 25ms",
      ],
    });
  });
});
