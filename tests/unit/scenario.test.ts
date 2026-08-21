import { describe, expect, it, vi } from "vitest";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

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

  it("matches textContains case-sensitively", async () => {
    const client = {
      callTool: vi.fn(async () => ({
        content: [{ type: "text" as const, text: "Expected phrase" }],
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

describe("scenario observer", () => {
  const observer: NonNullable<Scenario["observe"]> = {
    call: { tool: "read_state", args: {} },
    expect: {
      outcome: "success",
      result: { isError: false, textContains: "ready" },
    },
  };
  const scenario: Scenario = {
    name: "observe resulting state",
    call: { tool: "write_state", args: { value: "ready" } },
    expect: { outcome: "success" },
    observe: observer,
  };

  it("runs the observer after the primary call and records a passing observation", async () => {
    const client = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({ content: [{ type: "text" as const, text: "written" }] })
        .mockResolvedValueOnce({ content: [{ type: "text" as const, text: "ready" }] }),
    };

    const recording = await runScenario(client, scenario, clockReturning(10, 15, 20, 23));

    expect(client.callTool.mock.calls.map(([call]) => call.name)).toEqual([
      "write_state",
      "read_state",
    ]);
    expect(recording).toMatchObject({
      passed: true,
      failures: [],
      observer: {
        outcome: "success",
        durationMs: 3,
        passed: true,
        failures: [],
      },
    });
  });

  it("reports observer assertion failures separately", async () => {
    const client = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({ content: [{ type: "text" as const, text: "written" }] })
        .mockResolvedValueOnce({ content: [{ type: "text" as const, text: "pending" }] }),
    };

    const recording = await runScenario(client, scenario, clockReturning(10, 15, 20, 23));

    expect(recording).toMatchObject({
      passed: false,
      failures: ['observer: expected result text to contain "ready"'],
      observer: {
        outcome: "success",
        passed: false,
        failures: ['expected result text to contain "ready"'],
      },
    });
  });

  it("records observer execution failures", async () => {
    const observerError = new Error("observer unavailable");
    const client = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({ content: [{ type: "text" as const, text: "written" }] })
        .mockRejectedValueOnce(observerError),
    };
    const observerFailureScenario: Scenario = {
      ...scenario,
      observe: {
        ...observer,
        expect: { outcome: "error" },
      },
    };

    const recording = await runScenario(
      client,
      observerFailureScenario,
      clockReturning(10, 15, 20, 23),
    );

    expect(recording).toMatchObject({
      passed: false,
      failures: ["observer: observer execution failed: observer unavailable"],
      observer: {
        outcome: "error",
        passed: false,
        failures: ["observer execution failed: observer unavailable"],
        error: observerError,
      },
    });
  });

  it("fails verification when the observer times out even if timeout is expected", async () => {
    const client = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({ content: [{ type: "text" as const, text: "written" }] })
        .mockRejectedValueOnce(new McpError(ErrorCode.RequestTimeout, "observer timed out")),
    };
    const observerTimeoutScenario: Scenario = {
      ...scenario,
      observe: {
        ...observer,
        expect: { outcome: "timeout" },
      },
    };

    const recording = await runScenario(
      client,
      observerTimeoutScenario,
      clockReturning(10, 15, 20, 23),
    );

    expect(recording).toMatchObject({
      passed: false,
      failures: ["observer: observer execution timed out"],
      observer: {
        outcome: "timeout",
        passed: false,
        failures: ["observer execution timed out"],
      },
    });
  });

  it("runs the observer when the primary call fails", async () => {
    const primaryError = new Error("write failed");
    const client = {
      callTool: vi
        .fn()
        .mockRejectedValueOnce(primaryError)
        .mockResolvedValueOnce({ content: [{ type: "text" as const, text: "ready" }] }),
    };
    const primaryFailureScenario: Scenario = {
      ...scenario,
      expect: { outcome: "error" },
    };

    const recording = await runScenario(
      client,
      primaryFailureScenario,
      clockReturning(10, 15, 20, 23),
    );

    expect(client.callTool).toHaveBeenCalledTimes(2);
    expect(recording).toMatchObject({
      outcome: "error",
      passed: true,
      failures: [],
      error: primaryError,
      observer: { outcome: "success", passed: true },
    });
  });
});
