import { describe, expect, it } from "vitest";

import { createJUnitScenarioReport } from "../../src/junitReport.js";
import type { ScenarioResult } from "../../src/scenario.js";

function result(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    name: "example scenario",
    outcome: "success",
    durationMs: 12,
    passed: true,
    failures: [],
    ...overrides,
  };
}

describe("JUnit scenario report mapping", () => {
  it("maps a passing primary result", () => {
    expect(createJUnitScenarioReport(result())).toEqual({
      name: "example scenario",
      durationMs: 12,
      testCases: [
        {
          name: "example scenario",
          source: "primary",
          durationMs: 12,
          outcome: { status: "passed" },
          diagnostics: [],
        },
      ],
      executionDiagnostics: [],
    });
  });

  it("maps primary assertion failures", () => {
    const failures = ["expected outcome success, received error"];

    expect(
      createJUnitScenarioReport(result({ outcome: "error", passed: false, failures })).testCases[0],
    ).toMatchObject({
      source: "primary",
      outcome: { status: "failed", failures },
      diagnostics: failures,
    });
  });

  it("maps an unexpected primary execution error", () => {
    expect(
      createJUnitScenarioReport(
        result({ outcome: "error", passed: false, error: new Error("connection closed") }),
      ).testCases[0],
    ).toMatchObject({
      source: "primary",
      outcome: { status: "errored", message: "connection closed" },
    });
  });

  it("keeps observer failures separate from primary failures", () => {
    const report = createJUnitScenarioReport(
      result({
        durationMs: 10,
        passed: false,
        failures: ["observer: expected outcome success, received timeout"],
        observer: {
          outcome: "timeout",
          durationMs: 4,
          passed: false,
          failures: ["expected outcome success, received timeout"],
        },
      }),
    );

    expect(report.durationMs).toBe(14);
    expect(report.testCases).toMatchObject([
      { source: "primary", durationMs: 10, outcome: { status: "passed" } },
      {
        source: "observer",
        durationMs: 4,
        outcome: {
          status: "failed",
          failures: ["expected outcome success, received timeout"],
        },
      },
    ]);
  });

  it("uses external lifecycle duration without counting primary time twice", () => {
    const report = createJUnitScenarioReport(
      result({
        durationMs: 5,
        execution: {
          mode: "external",
          adapter: "mcp",
          passed: true,
          diagnostics: [
            {
              operation: "setup",
              operationId: "setup",
              outcome: "success",
              durationMs: 2,
            },
            {
              operation: "execute",
              operationId: "execute",
              outcome: "success",
              durationMs: 5,
            },
            {
              operation: "cleanup",
              operationId: "cleanup",
              outcome: "success",
              durationMs: 3,
            },
          ],
        },
      }),
    );

    expect(report.durationMs).toBe(10);
    expect(report.testCases).toHaveLength(2);
    expect(report.testCases[1]).toMatchObject({
      source: "execution",
      durationMs: 10,
      outcome: { status: "passed" },
    });
  });

  it("maps adapter lifecycle failures to execution errors", () => {
    const report = createJUnitScenarioReport(
      result({
        passed: false,
        execution: {
          mode: "external",
          adapter: "mcp",
          passed: false,
          diagnostics: [
            {
              operation: "cleanup",
              operationId: "cleanup",
              outcome: "error",
              durationMs: 3,
              message: "connection closed",
            },
          ],
        },
      }),
    );

    expect(report.testCases[1]).toMatchObject({
      source: "execution",
      outcome: { status: "errored", message: "cleanup: error - connection closed" },
      diagnostics: ["cleanup: error - connection closed"],
    });
  });
});
