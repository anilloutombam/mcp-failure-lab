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
});
