import { performance } from "node:perf_hooks";

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  CallToolResultSchema,
  ErrorCode,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

export type ScenarioOutcome = "success" | "error" | "timeout";

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
  const failures: string[] = [];

  if (outcome !== scenario.expect.outcome) {
    failures.push(`expected outcome ${scenario.expect.outcome}, received ${outcome}`);
  }

  if (scenario.expect.maxDurationMs !== undefined && durationMs > scenario.expect.maxDurationMs) {
    failures.push(
      `expected duration at most ${scenario.expect.maxDurationMs}ms, received ${durationMs}ms`,
    );
  }

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
