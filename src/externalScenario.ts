import { SdkError, SdkErrorCode, type CallToolResult } from "@modelcontextprotocol/client";
import type {
  ExternalExecutionDiagnostic,
  Scenario,
  ScenarioCall,
  ScenarioResult,
} from "./scenario.js";
import { DEFAULT_SCENARIO_TIMEOUT_MS, runScenario } from "./scenario.js";
import {
  boundedTimeoutMs,
  type TargetClientAdapter,
  type TargetClientObservation,
  type TargetClientOperation,
  type TargetClientOutcome,
} from "./targetClientAdapter.js";

export interface OperationIdFactory {
  next(operation: TargetClientOperation): string;
}

export class SequentialOperationIdFactory implements OperationIdFactory {
  private sequence = 0;

  constructor(private readonly runId = "external-run") {}

  next(operation: TargetClientOperation): string {
    this.sequence += 1;
    return `${this.runId}:${operation}:${this.sequence}`;
  }
}

export async function runExternalScenario<TConfig>(
  adapterName: string,
  adapter: TargetClientAdapter<TConfig, ScenarioCall, CallToolResult, ScenarioCall, CallToolResult>,
  config: TConfig,
  scenario: Scenario,
  operationIds: OperationIdFactory = new SequentialOperationIdFactory(),
): Promise<ScenarioResult> {
  const diagnostics: ExternalExecutionDiagnostic[] = [];
  const primaryTimeout = boundedTimeoutMs(scenario.timeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS);
  const setup = record(
    diagnostics,
    await adapter.setup({
      operationId: operationIds.next("setup"),
      config,
      timeoutMs: primaryTimeout,
    }),
  );

  if (setup.outcome !== "success") {
    return adapterSetupFailure(adapterName, scenario, setup, diagnostics);
  }

  const session = setup.value;
  let callIndex = 0;
  let result: ScenarioResult;

  try {
    result = await runScenario(
      {
        callTool: async () => {
          const isObserver = callIndex++ > 0;
          const observation = record(
            diagnostics,
            isObserver && scenario.observe !== undefined
              ? await session.observe({
                  operationId: operationIds.next("observe"),
                  observation: scenario.observe.call,
                  timeoutMs: boundedTimeoutMs(
                    scenario.observe.timeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS,
                  ),
                })
              : await session.execute({
                  operationId: operationIds.next("execute"),
                  scenario: scenario.call,
                  timeoutMs: primaryTimeout,
                }),
          );

          if (observation.outcome === "success") return observation.value;
          if (observation.outcome === "timeout") {
            record(
              diagnostics,
              await session.cancel({
                operationId: operationIds.next("cancel"),
                timeoutMs: primaryTimeout,
                reason: `${observation.operation} timed out`,
              }),
            );
            throw new SdkError(SdkErrorCode.RequestTimeout, observation.failure.message);
          }
          throw new TargetClientOperationError(
            observation.operation,
            observation.outcome,
            observation.failure.message,
          );
        },
      },
      scenario,
    );
  } finally {
    record(
      diagnostics,
      await session.cleanup({
        operationId: operationIds.next("cleanup"),
        timeoutMs: primaryTimeout,
      }),
    );
  }

  const adapterPassed = diagnostics.every(isSuccessfulInfrastructureOperation);
  return {
    ...result,
    passed: result.passed && adapterPassed,
    execution: { mode: "external", adapter: adapterName, passed: adapterPassed, diagnostics },
  };
}

export class TargetClientOperationError extends Error {
  constructor(
    readonly operation: TargetClientOperation,
    readonly outcome: TargetClientOutcome,
    message: string,
  ) {
    super(`adapter ${operation} failed: ${message}`);
    this.name = "TargetClientOperationError";
  }
}

function adapterSetupFailure<T>(
  adapter: string,
  scenario: Scenario,
  setup: Exclude<TargetClientObservation<T>, { outcome: "success" }>,
  diagnostics: ExternalExecutionDiagnostic[],
): ScenarioResult {
  return {
    name: scenario.name,
    outcome: "error",
    durationMs: setup.durationMs,
    passed: false,
    failures: [],
    error: new TargetClientOperationError("setup", setup.outcome, setup.failure.message),
    execution: { mode: "external", adapter, passed: false, diagnostics },
  };
}

function record<T>(
  diagnostics: ExternalExecutionDiagnostic[],
  observation: TargetClientObservation<T>,
): TargetClientObservation<T> {
  diagnostics.push({
    operation: observation.operation,
    operationId: observation.operationId,
    outcome: observation.outcome,
    durationMs: observation.durationMs,
    ...(observation.outcome === "success" ? {} : { message: observation.failure.message }),
  });
  return observation;
}

function isSuccessfulInfrastructureOperation(diagnostic: ExternalExecutionDiagnostic): boolean {
  if (diagnostic.operation === "execute" || diagnostic.operation === "observe") {
    return diagnostic.outcome === "success" || diagnostic.outcome === "timeout";
  }
  return diagnostic.outcome === "success";
}
