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
      `Assertions: ${result.passed ? "passed" : "failed"}`,
    ];

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
      ...(result.result === undefined ? {} : { result: result.result }),
      ...(result.error === undefined ? {} : { error: errorMessage(result.error) }),
    };

    return JSON.stringify(report, null, 2);
  }
}
