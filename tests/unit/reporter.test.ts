import { describe, expect, it } from "vitest";

import { ConsoleScenarioReporter, JsonScenarioReporter } from "../../src/reporter.js";
import type { ScenarioResult } from "../../src/scenario.js";

const consoleReporter = new ConsoleScenarioReporter();
const jsonReporter = new JsonScenarioReporter();

function result(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    name: "example scenario",
    outcome: "success",
    durationMs: 12.5,
    passed: true,
    failures: [],
    ...overrides,
  };
}

describe("console scenario reporter", () => {
  it("reports a successful result", () => {
    expect(consoleReporter.report(result())).toBe(
      [
        "Scenario: example scenario",
        "Outcome: success",
        "Duration: 12.50 ms",
        "Assertions: passed",
      ].join("\n"),
    );
  });

  it("reports a failed result and each assertion failure", () => {
    expect(
      consoleReporter.report(
        result({
          passed: false,
          failures: [
            "expected outcome timeout, received success",
            "expected duration at most 10ms, received 12.5ms",
          ],
        }),
      ),
    ).toContain(
      [
        "Assertions: failed",
        "Failures:",
        "- expected outcome timeout, received success",
        "- expected duration at most 10ms, received 12.5ms",
      ].join("\n"),
    );
  });

  it("reports observer outcome and assertion status", () => {
    expect(
      consoleReporter.report(
        result({
          observer: {
            outcome: "success",
            durationMs: 2.5,
            passed: true,
            failures: [],
          },
        }),
      ),
    ).toContain(
      [
        "Observer outcome: success",
        "Observer duration: 2.50 ms",
        "Observer assertions: passed",
      ].join("\n"),
    );
  });

  it("reports external adapter lifecycle diagnostics", () => {
    expect(
      consoleReporter.report(
        result({
          execution: {
            mode: "external",
            adapter: "mcp",
            passed: false,
            diagnostics: [
              { operation: "setup", outcome: "success", durationMs: 1.25 },
              {
                operation: "cleanup",
                outcome: "error",
                durationMs: 2.5,
                message: "connection closed",
              },
            ],
          },
        }),
      ),
    ).toContain(
      [
        "Execution: external (mcp)",
        "Adapter lifecycle: failed",
        "Adapter setup: success (1.25 ms)",
        "Adapter cleanup: error (2.50 ms) - connection closed",
      ].join("\n"),
    );
  });
});

describe("JSON scenario reporter", () => {
  it("reports an errored result with a stable serializable error", () => {
    expect(
      JSON.parse(jsonReporter.report(result({ outcome: "error", error: new Error("closed") }))),
    ).toEqual({
      name: "example scenario",
      outcome: "error",
      durationMs: 12.5,
      passed: true,
      failures: [],
      error: "closed",
    });
  });

  it("reports a timed-out result", () => {
    expect(JSON.parse(jsonReporter.report(result({ outcome: "timeout", durationMs: 25 })))).toEqual(
      {
        name: "example scenario",
        outcome: "timeout",
        durationMs: 25,
        passed: true,
        failures: [],
      },
    );
  });

  it("serializes observer recordings and errors", () => {
    expect(
      JSON.parse(
        jsonReporter.report(
          result({
            passed: false,
            failures: ["observer: observer execution failed: observer unavailable"],
            observer: {
              outcome: "error",
              durationMs: 4,
              passed: false,
              failures: ["observer execution failed: observer unavailable"],
              error: new Error("observer unavailable"),
            },
          }),
        ),
      ),
    ).toMatchObject({
      passed: false,
      observer: {
        outcome: "error",
        durationMs: 4,
        passed: false,
        failures: ["observer execution failed: observer unavailable"],
        error: "observer unavailable",
      },
    });
  });

  it("serializes external execution metadata", () => {
    const execution = {
      mode: "external" as const,
      adapter: "mcp",
      passed: true,
      diagnostics: [{ operation: "setup" as const, outcome: "success" as const, durationMs: 1 }],
    };

    expect(JSON.parse(jsonReporter.report(result({ execution })))).toMatchObject({ execution });
  });
});
