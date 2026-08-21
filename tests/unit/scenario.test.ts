import { describe, expect, it, vi } from "vitest";

import { runScenario, type MonotonicClock, type Scenario } from "../../src/scenario.js";

function clockReturning(...values: number[]): MonotonicClock {
  const now = vi.fn();
  values.forEach((value) => now.mockReturnValueOnce(value));
  return { now };
}

function scenarioWithResultExpectation(
  result: NonNullable<Scenario["expect"]["result"]>,
): Scenario {
  return {
    name: "result assertion",
    call: { tool: "example", args: {} },
    expect: { outcome: "success", result },
  };
}

describe("scenario result assertions", () => {
  it("passes when isError matches the MCP result", async () => {
    const client = {
      callTool: vi.fn(async () => ({
        content: [{ type: "text" as const, text: "failed as expected" }],
        isError: true,
      })),
    };
    const scenario = scenarioWithResultExpectation({ isError: true });
    scenario.expect.outcome = "error";

    const recording = await runScenario(client, scenario, clockReturning(10, 15));

    expect(recording).toMatchObject({ passed: true, failures: [] });
  });

  it("reports an isError mismatch", async () => {
    const client = {
      callTool: vi.fn(async () => ({
        content: [{ type: "text" as const, text: "completed" }],
      })),
    };

    const recording = await runScenario(
      client,
      scenarioWithResultExpectation({ isError: true }),
      clockReturning(10, 15),
    );

    expect(recording).toMatchObject({
      passed: false,
      failures: ["expected result isError true, received false"],
    });
  });

  it("checks textContains against MCP text content", async () => {
    const client = {
      callTool: vi.fn(async () => ({
        content: [
          { type: "image" as const, data: "ZXhwZWN0ZWQgcGhyYXNl", mimeType: "image/png" },
          { type: "text" as const, text: "the actual response" },
        ],
        structuredContent: { message: "expected phrase" },
      })),
    };

    const recording = await runScenario(
      client,
      scenarioWithResultExpectation({ textContains: "expected phrase" }),
      clockReturning(10, 15),
    );

    expect(recording).toMatchObject({
      passed: false,
      failures: ['expected result text to contain "expected phrase"'],
    });
  });

  it("passes when an MCP text content item contains the expected text", async () => {
    const client = {
      callTool: vi.fn(async () => ({
        content: [
          { type: "text" as const, text: "first item" },
          { type: "text" as const, text: "contains the expected phrase" },
        ],
      })),
    };

    const recording = await runScenario(
      client,
      scenarioWithResultExpectation({ textContains: "expected phrase" }),
      clockReturning(10, 15),
    );

    expect(recording).toMatchObject({ passed: true, failures: [] });
  });

  it("reports a missing result when execution throws", async () => {
    const client = {
      callTool: vi.fn(async () => {
        throw new Error("connection closed");
      }),
    };
    const scenario = scenarioWithResultExpectation({ textContains: "completed" });
    scenario.expect.outcome = "error";

    const recording = await runScenario(client, scenario, clockReturning(10, 15));

    expect(recording).toMatchObject({
      passed: false,
      failures: ["expected a result, but no result was received"],
    });
  });
});
