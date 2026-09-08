import type {
  ExternalExecutionDiagnostic,
  ScenarioObservationResult,
  ScenarioResult,
} from "./scenario.js";

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function observationOutcome(
  passed: boolean,
  failures: readonly string[],
  error: unknown,
): JUnitTestCaseOutcome {
  if (passed) return { status: "passed" };
  if (error !== undefined) return { status: "errored", message: errorMessage(error) };
  return { status: "failed", failures };
}

function observerTestCase(
  scenarioName: string,
  observer: ScenarioObservationResult,
): JUnitTestCaseReport {
  return {
    name: `${scenarioName} (observer)`,
    source: "observer",
    durationMs: observer.durationMs,
    outcome: observationOutcome(observer.passed, observer.failures, observer.error),
    diagnostics: observer.failures,
  };
}

function executionTestCase(result: ScenarioResult): JUnitTestCaseReport | undefined {
  if (result.execution === undefined) return undefined;

  const failedDiagnostics = result.execution.diagnostics.filter(
    (diagnostic) => diagnostic.outcome !== "success",
  );
  const diagnostics = failedDiagnostics.map(
    (diagnostic) =>
      `${diagnostic.operation}: ${diagnostic.outcome}${
        diagnostic.message === undefined ? "" : ` - ${diagnostic.message}`
      }`,
  );

  return {
    name: `${result.name} (execution)`,
    source: "execution",
    durationMs: result.execution.diagnostics.reduce(
      (durationMs, diagnostic) => durationMs + diagnostic.durationMs,
      0,
    ),
    outcome: result.execution.passed
      ? { status: "passed" }
      : { status: "errored", message: diagnostics.join("\n") || "adapter lifecycle failed" },
    diagnostics,
  };
}

export function createJUnitScenarioReport(result: ScenarioResult): JUnitScenarioReport {
  const observerFailureCount = result.observer?.failures.length ?? 0;
  const primaryFailures = result.failures.slice(0, result.failures.length - observerFailureCount);
  const primaryPassed =
    primaryFailures.length === 0 && (result.error === undefined || result.passed);
  const primary: JUnitTestCaseReport = {
    name: result.name,
    source: "primary",
    durationMs: result.durationMs,
    outcome: observationOutcome(primaryPassed, primaryFailures, result.error),
    diagnostics: primaryFailures,
  };
  const observer =
    result.observer === undefined ? undefined : observerTestCase(result.name, result.observer);
  const execution = executionTestCase(result);

  return {
    name: result.name,
    durationMs:
      result.durationMs + (result.observer?.durationMs ?? 0) + (execution?.durationMs ?? 0),
    testCases: [
      primary,
      ...(observer === undefined ? [] : [observer]),
      ...(execution === undefined ? [] : [execution]),
    ],
    executionDiagnostics: result.execution?.diagnostics ?? [],
  };
}
