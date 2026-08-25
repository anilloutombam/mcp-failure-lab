import { performance } from "node:perf_hooks";
import { CallToolResultSchema } from "@modelcontextprotocol/core";
import { SdkErrorCode, SdkError } from "@modelcontextprotocol/client";
import type { Client, CallToolResult } from "@modelcontextprotocol/client";

export type ScenarioOutcome = "success" | "error" | "timeout";

export interface ScenarioResultExpectation {
  isError?: boolean;
  textContains?: string;
}

export interface ScenarioCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ScenarioExpectation {
  outcome: ScenarioOutcome;
  maxDurationMs?: number;
  result?: ScenarioResultExpectation;
}

export interface ScenarioObserver {
  call: ScenarioCall;
  timeoutMs?: number;
  expect: ScenarioExpectation;
}

export interface Scenario {
  name: string;
  call: ScenarioCall;
  timeoutMs?: number;
  expect: ScenarioExpectation;
  observe?: ScenarioObserver;
}

export interface ScenarioObservationResult {
  outcome: ScenarioOutcome;
  durationMs: number;
  passed: boolean;
  failures: string[];
  result?: CallToolResult;
  error?: unknown;
}

export interface ScenarioResult {
  name: string;
  outcome: ScenarioOutcome;
  durationMs: number;
  passed: boolean;
  failures: string[];
  result?: CallToolResult;
  error?: unknown;
  observer?: ScenarioObservationResult;
}

export interface MonotonicClock {
  now(): number;
}

type ScenarioClient = Pick<Client, "callTool">;

const systemClock: MonotonicClock = performance;

function classifyError(error: unknown): ScenarioOutcome {
  return error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout
    ? "timeout"
    : "error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ScenarioObservation {
  outcome: ScenarioOutcome;
  durationMs: number;
  result?: CallToolResult;
  error?: unknown;
}

function evaluateExpectation(
  expectation: ScenarioExpectation,
  observation: ScenarioObservation,
): string[] {
  const failures: string[] = [];

  if (observation.outcome !== expectation.outcome) {
    failures.push(`expected outcome ${expectation.outcome}, received ${observation.outcome}`);
  }

  if (
    expectation.maxDurationMs !== undefined &&
    observation.durationMs > expectation.maxDurationMs
  ) {
    failures.push(
      `expected duration at most ${expectation.maxDurationMs}ms, received ${observation.durationMs}ms`,
    );
  }

  const resultExpectation = expectation.result;
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

async function executeCall(
  client: ScenarioClient,
  call: ScenarioCall,
  timeoutMs: number | undefined,
  clock: MonotonicClock,
): Promise<ScenarioObservation> {
  const startedAt = clock.now();
  let outcome: ScenarioOutcome;
  let result: CallToolResult | undefined;
  let error: unknown;

  try {
    const response = await client.callTool(
      { name: call.tool, arguments: call.args },
      timeoutMs === undefined ? undefined : { timeout: timeoutMs },
    );
    result = CallToolResultSchema.parse(response);
    outcome = result.isError ? "error" : "success";
  } catch (caught) {
    error = caught;
    outcome = classifyError(caught);
  }

  return {
    outcome,
    durationMs: clock.now() - startedAt,
    ...(result === undefined ? {} : { result }),
    ...(error === undefined ? {} : { error }),
  };
}

export async function runScenario(
  client: ScenarioClient,
  scenario: Scenario,
  clock: MonotonicClock = systemClock,
): Promise<ScenarioResult> {
  const primaryObservation = await executeCall(client, scenario.call, scenario.timeoutMs, clock);
  const primaryFailures = evaluateExpectation(scenario.expect, primaryObservation);
  let observer: ScenarioObservationResult | undefined;

  if (scenario.observe !== undefined) {
    const observerObservation = await executeCall(
      client,
      scenario.observe.call,
      scenario.observe.timeoutMs,
      clock,
    );
    const observerFailures =
      observerObservation.error === undefined
        ? evaluateExpectation(scenario.observe.expect, observerObservation)
        : [
            observerObservation.outcome === "timeout"
              ? "observer execution timed out"
              : `observer execution failed: ${errorMessage(observerObservation.error)}`,
          ];
    observer = {
      ...observerObservation,
      passed: observerFailures.length === 0,
      failures: observerFailures,
    };
  }

  const failures = [
    ...primaryFailures,
    ...(observer?.failures.map((failure) => `observer: ${failure}`) ?? []),
  ];

  return {
    name: scenario.name,
    outcome: primaryObservation.outcome,
    durationMs: primaryObservation.durationMs,
    passed: failures.length === 0,
    failures,
    ...(primaryObservation.result === undefined ? {} : { result: primaryObservation.result }),
    ...(primaryObservation.error === undefined ? {} : { error: primaryObservation.error }),
    ...(observer === undefined ? {} : { observer }),
  };
}
