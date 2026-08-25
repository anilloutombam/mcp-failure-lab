import { readFile } from "node:fs/promises";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import {
  ConsoleScenarioReporter,
  JsonScenarioReporter,
  type ScenarioReporter,
} from "./reporter.js";
import { runScenario, type Scenario, type ScenarioResult } from "./scenario.js";
import { createServer } from "./server.js";

export const DEFAULT_SCENARIO_TIMEOUT_MS = 30_000;

const callSchema = z
  .object({
    tool: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
  })
  .strict();

const resultExpectationSchema = z
  .object({
    isError: z.boolean().optional(),
    textContains: z.string().optional(),
  })
  .strict();

const expectationSchema = z
  .object({
    outcome: z.enum(["success", "error", "timeout"]),
    maxDurationMs: z.number().nonnegative().optional(),
    result: resultExpectationSchema.optional(),
  })
  .strict();

const scenarioSchema = z
  .object({
    name: z.string().min(1),
    call: callSchema,
    timeoutMs: z.number().int().positive().optional(),
    expect: expectationSchema,
    observe: z
      .object({
        call: callSchema,
        timeoutMs: z.number().int().positive().optional(),
        expect: expectationSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

type ValidatedExpectation = z.infer<typeof expectationSchema>;

function toScenarioExpectation(expectation: ValidatedExpectation): Scenario["expect"] {
  return {
    outcome: expectation.outcome,
    ...(expectation.maxDurationMs === undefined
      ? {}
      : { maxDurationMs: expectation.maxDurationMs }),
    ...(expectation.result === undefined
      ? {}
      : {
          result: {
            ...(expectation.result.isError === undefined
              ? {}
              : { isError: expectation.result.isError }),
            ...(expectation.result.textContains === undefined
              ? {}
              : { textContains: expectation.result.textContains }),
          },
        }),
  };
}

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
    expect: toScenarioExpectation(scenario.expect),
    timeoutMs: scenario.timeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS,
    ...(scenario.observe === undefined
      ? {}
      : {
          observe: {
            call: scenario.observe.call,
            timeoutMs: scenario.observe.timeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS,
            expect: toScenarioExpectation(scenario.observe.expect),
          },
        }),
  };
}

export function formatScenarioResult(result: ScenarioResult, format: ReportFormat): string {
  const reporter: ScenarioReporter =
    format === "json" ? new JsonScenarioReporter() : new ConsoleScenarioReporter();
  return reporter.report(result);
}

export async function executeScenario(scenario: Scenario): Promise<ScenarioResult> {
  const client = new Client(
    {
      name: "mcp-failure-lab-scenario-client",
      version: "0.1.0",
    },
    {
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const serverHandle = serveStdio(() => createServer(), { transport: serverTransport });

  try {
    await client.connect(clientTransport);
    return await runScenario(client, scenario);
  } finally {
    await client.close();
    await serverHandle.close();
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
