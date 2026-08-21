import { performance } from "node:perf_hooks";

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  CallToolResultSchema,
  ErrorCode,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

export type ScenarioOutcome = "success" | "error" | "timeout";

export interface ScenarioResultExpectation {
  isError?: boolean;
  textContains?: string;
}

export interface Scenario {
  name: string;
  call: {
    tool: string;
    args: Record<string, unknown>;
  };
  timeoutMs?: number;
  expect: {
    outcome: ScenarioOutcome;
    maxDurationMs?: number;
    result?: ScenarioResultExpectation;
  };
}

export interface ScenarioResult {
  name: string;
  outcome: ScenarioOutcome;
  durationMs: number;
  passed: boolean;
  failures: string[];
  result?: CallToolResult;
  error?: unknown;
}

export interface MonotonicClock {
  now(): number;
}

type ScenarioClient = Pick<Client, "callTool">;

const systemClock: MonotonicClock = performance;

function classifyError(error: unknown): ScenarioOutcome {
  return error instanceof McpError && error.code === ErrorCode.RequestTimeout ? "timeout" : "error";
}

interface ScenarioObservation {
  outcome: ScenarioOutcome;
  durationMs: number;
  result?: CallToolResult;
}

function evaluateScenario(scenario: Scenario, observation: ScenarioObservation): string[] {
  const failures: string[] = [];

  if (observation.outcome !== scenario.expect.outcome) {
    failures.push(`expected outcome ${scenario.expect.outcome}, received ${observation.outcome}`);
  }

  if (
    scenario.expect.maxDurationMs !== undefined &&
    observation.durationMs > scenario.expect.maxDurationMs
  ) {
    failures.push(
      `expected duration at most ${scenario.expect.maxDurationMs}ms, received ${observation.durationMs}ms`,
    );
  }

  const resultExpectation = scenario.expect.result;
  if (resultExpectation === undefined) {
    return failures;
  }

  if (observation.result === undefined) {
    failures.push("expected a result, but no result was received");
    return failures;
  }

  if (
    resultExpectation.isError !== undefined &&
    Boolean(observation.result.isError) !== resultExpectation.isError
  ) {
    failures.push(
      `expected result isError ${resultExpectation.isError}, received ${Boolean(observation.result.isError)}`,
    );
  }

  const expectedText = resultExpectation.textContains;
  if (
    expectedText !== undefined &&
    !observation.result.content.some(
      (content) => content.type === "text" && content.text.includes(expectedText),
    )
  ) {
    failures.push(`expected result text to contain "${expectedText}"`);
  }

  return failures;
}

export async function runScenario(
  client: ScenarioClient,
  scenario: Scenario,
  clock: MonotonicClock = systemClock,
): Promise<ScenarioResult> {
  const startedAt = clock.now();
  let outcome: ScenarioOutcome;
  let result: CallToolResult | undefined;
  let error: unknown;

  try {
    const response = await client.callTool(
      { name: scenario.call.tool, arguments: scenario.call.args },
      CallToolResultSchema,
      scenario.timeoutMs === undefined ? undefined : { timeout: scenario.timeoutMs },
    );
    result = CallToolResultSchema.parse(response);
    outcome = result.isError ? "error" : "success";
  } catch (caught) {
    error = caught;
    outcome = classifyError(caught);
  }

  const durationMs = clock.now() - startedAt;
  const failures = evaluateScenario(scenario, {
    outcome,
    durationMs,
    ...(result === undefined ? {} : { result }),
  });

  return {
    name: scenario.name,
    outcome,
    durationMs,
    passed: failures.length === 0,
    failures,
    ...(result === undefined ? {} : { result }),
    ...(error === undefined ? {} : { error }),
  };
}
