import {
  executeScenario,
  formatScenarioResult,
  type ScenarioCommandOutput,
} from "./scenarioCommand.js";
import type { Scenario, ScenarioResult } from "./scenario.js";

const DEMO_SCENARIO: Scenario = {
  name: "Deterministic delay demo",
  call: {
    tool: "delay",
    args: {
      delayMs: 500,
    },
  },
  expect: {
    outcome: "success",
    maxDurationMs: 2_000,
  },
  timeoutMs: 5_000,
};

type ScenarioExecutor = (scenario: Scenario) => Promise<ScenarioResult>;

export async function runDemoCommand(
  output: ScenarioCommandOutput,
  execute: ScenarioExecutor = executeScenario,
): Promise<number> {
  try {
    output.write("MCP Failure Lab — Demo");
    output.write("Running a real 500ms delay scenario...");
    output.write("");

    const result = await execute(DEMO_SCENARIO);

    output.write(formatScenarioResult(result, "console"));

    return result.passed ? 0 : 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.writeError(`Demo failed: ${message}`);
    return 1;
  }
}
