import { readFile } from "node:fs/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";

import { runScenario, type Scenario, type ScenarioResult } from "./scenario.js";
import { createServer } from "./server.js";

export const DEFAULT_SCENARIO_TIMEOUT_MS = 30_000;

const scenarioSchema = z
  .object({
    name: z.string().min(1),
    call: z
      .object({
        tool: z.string().min(1),
        args: z.record(z.string(), z.unknown()),
      })
      .strict(),
    timeoutMs: z.number().int().positive().optional(),
    expect: z
      .object({
        outcome: z.enum(["success", "error", "timeout"]),
        maxDurationMs: z.number().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export type ReportFormat = "console" | "json";
export type ScenarioCommandErrorCode =
  "invalid_arguments" | "scenario_load_failed" | "scenario_execution_failed";

export interface ScenarioCommandOutput {
  write(message: string): void;
  writeError(message: string): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function writeScenarioCommandError(
  code: ScenarioCommandErrorCode,
  message: string,
  format: ReportFormat,
  output: ScenarioCommandOutput,
): void {
  if (format === "json") {
    output.write(
      JSON.stringify(
        {
          passed: false,
          error: { code, message },
        },
        null,
        2,
      ),
    );
    return;
  }

  output.writeError(message);
}

export async function loadScenario(path: string): Promise<Scenario> {
  let source: string;

  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read scenario file ${path}: ${errorMessage(error)}`, { cause: error });
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`scenario file ${path} is not valid JSON: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  const validated = scenarioSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`scenario file ${path} is invalid: ${z.prettifyError(validated.error)}`);
  }

  const scenario = validated.data;

  return {
    name: scenario.name,
    call: scenario.call,
    expect: {
      outcome: scenario.expect.outcome,
      ...(scenario.expect.maxDurationMs === undefined
        ? {}
        : { maxDurationMs: scenario.expect.maxDurationMs }),
    },
    timeoutMs: scenario.timeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS,
  };
}

export function formatScenarioResult(result: ScenarioResult, format: ReportFormat): string {
  if (format === "json") {
    return JSON.stringify(
      {
        name: result.name,
        outcome: result.outcome,
        durationMs: result.durationMs,
        passed: result.passed,
        failures: result.failures,
        ...(result.result === undefined ? {} : { result: result.result }),
        ...(result.error === undefined ? {} : { error: errorMessage(result.error) }),
      },
      null,
      2,
    );
  }

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

export async function executeScenario(scenario: Scenario): Promise<ScenarioResult> {
  const server = createServer();
  const client = new Client({
    name: "mcp-failure-lab-scenario-client",
    version: "0.1.0",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await runScenario(client, scenario);
  } finally {
    await client.close();
    await server.close();
  }
}

export async function runScenarioCommand(
  path: string,
  format: ReportFormat,
  output: ScenarioCommandOutput,
): Promise<number> {
  let scenario: Scenario;

  try {
    scenario = await loadScenario(path);
  } catch (error) {
    writeScenarioCommandError(
      "scenario_load_failed",
      `Failed to run scenario: ${errorMessage(error)}`,
      format,
      output,
    );
    return 1;
  }

  try {
    const result = await executeScenario(scenario);
    output.write(formatScenarioResult(result, format));
    return result.passed ? 0 : 2;
  } catch (error) {
    writeScenarioCommandError(
      "scenario_execution_failed",
      `Failed to run scenario: ${errorMessage(error)}`,
      format,
      output,
    );
    return 1;
  }
}
