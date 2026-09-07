import type { ExternalExecutionDiagnostic } from "./scenario.js";

export type JUnitTestCaseOutcome =
  | { status: "passed" }
  | { status: "failed"; failures: readonly string[] }
  | { status: "errored"; message: string };

export type JUnitTestCaseSource = "primary" | "observer" | "execution";

export interface JUnitTestCaseReport {
  name: string;
  source: JUnitTestCaseSource;
  durationMs: number;
  outcome: JUnitTestCaseOutcome;
  diagnostics: readonly string[];
}

export interface JUnitScenarioReport {
  name: string;
  durationMs: number;
  testCases: readonly JUnitTestCaseReport[];
  executionDiagnostics: readonly ExternalExecutionDiagnostic[];
}

export const JUNIT_XML_OUTCOME_ELEMENTS = {
  passed: undefined,
  failed: "failure",
  errored: "error",
} as const satisfies Record<JUnitTestCaseOutcome["status"], "failure" | "error" | undefined>;
