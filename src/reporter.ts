import type { ScenarioResult } from "./scenario.js";

export interface ScenarioReporter {
  report(result: ScenarioResult): string;
}

export interface JsonScenarioReport {
  name: string;
  outcome: ScenarioResult["outcome"];
  durationMs: number;
  passed: boolean;
  failures: string[];
  result?: ScenarioResult["result"];
  error?: string;
  observer?: {
    outcome: ScenarioResult["outcome"];
    durationMs: number;
    passed: boolean;
    failures: string[];
    result?: ScenarioResult["result"];
    error?: string;
  };
  execution?: ScenarioResult["execution"];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ConsoleScenarioReporter implements ScenarioReporter {
  report(result: ScenarioResult): string {
    const lines = [
      `Scenario: ${result.name}`,
      `Outcome: ${result.outcome}`,
      `Duration: ${result.durationMs.toFixed(2)} ms`,
    ];

    if (result.observer !== undefined) {
      lines.push(
        `Observer outcome: ${result.observer.outcome}`,
        `Observer duration: ${result.observer.durationMs.toFixed(2)} ms`,
        `Observer assertions: ${result.observer.passed ? "passed" : "failed"}`,
      );
    }
    if (result.execution !== undefined)
      lines.push(
        `Execution: external (${result.execution.adapter})`,
        `Adapter lifecycle: ${result.execution.passed ? "passed" : "failed"}`,
        ...result.execution.diagnostics.map(
          (item) =>
            `Adapter ${item.operation}: ${item.outcome} (${item.durationMs.toFixed(2)} ms)${
              item.message === undefined ? "" : ` - ${item.message}`
            }`,
        ),
      );

    lines.push(`Assertions: ${result.passed ? "passed" : "failed"}`);

    if (result.failures.length > 0) {
      lines.push("Failures:", ...result.failures.map((failure) => `- ${failure}`));
    }

    return lines.join("\n");
  }
}

export class JsonScenarioReporter implements ScenarioReporter {
  report(result: ScenarioResult): string {
    const report: JsonScenarioReport = {
      name: result.name,
      outcome: result.outcome,
      durationMs: result.durationMs,
      passed: result.passed,
      failures: [...result.failures],
      ...(result.execution === undefined ? {} : { execution: result.execution }),
      ...(result.result === undefined ? {} : { result: result.result }),
      ...(result.error === undefined ? {} : { error: errorMessage(result.error) }),
      ...(result.observer === undefined
        ? {}
        : {
            observer: {
              outcome: result.observer.outcome,
              durationMs: result.observer.durationMs,
              passed: result.observer.passed,
              failures: [...result.observer.failures],
              ...(result.observer.result === undefined ? {} : { result: result.observer.result }),
              ...(result.observer.error === undefined
                ? {}
                : { error: errorMessage(result.observer.error) }),
            },
          }),
    };

    return JSON.stringify(report, null, 2);
  }
}
