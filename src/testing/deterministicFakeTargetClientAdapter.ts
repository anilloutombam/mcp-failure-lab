import type {
  BoundedOperationRequest,
  TargetClientAdapter,
  TargetClientCancellationRequest,
  TargetClientCleanupRequest,
  TargetClientExecutionRequest,
  TargetClientFailure,
  TargetClientObservation,
  TargetClientObservationRequest,
  TargetClientOperation,
  TargetClientOutcome,
  TargetClientSession,
  TargetClientSetupRequest,
} from "../targetClientAdapter.js";

export type DeterministicFakeStep<T> =
  | { outcome: "success"; durationMs: number; value: T }
  | {
      outcome: Exclude<TargetClientOutcome, "success" | "timeout">;
      durationMs: number;
      failure: TargetClientFailure;
    };

export interface DeterministicFakePlan<TResult, TObserved> {
  setupDurationMs?: number;
  executions?: readonly DeterministicFakeStep<TResult>[];
  observations?: readonly DeterministicFakeStep<TObserved>[];
  cancellations?: readonly DeterministicFakeStep<void>[];
  cleanupDurationMs?: number;
}

export interface DeterministicFakeCall {
  operation: TargetClientOperation;
  operationId: string;
  timeoutMs: number;
  input?: unknown;
}

const exhaustedStep: DeterministicFakeStep<never> = {
  outcome: "error",
  durationMs: 0,
  failure: { code: "fake_plan_exhausted", message: "no deterministic fake step remains" },
};

/** Deterministic contract test double. It performs no I/O and contains no fault-tool behavior. */
export class DeterministicFakeTargetClientAdapter<
  TConfig,
  TScenario,
  TResult,
  TObservation,
  TObserved,
> implements TargetClientAdapter<TConfig, TScenario, TResult, TObservation, TObserved> {
  readonly calls: DeterministicFakeCall[] = [];
  cleanupCount = 0;

  private currentTimeMs = 0;
  private readonly executions: DeterministicFakeStep<TResult>[];
  private readonly observations: DeterministicFakeStep<TObserved>[];
  private readonly cancellations: DeterministicFakeStep<void>[];

  constructor(private readonly plan: DeterministicFakePlan<TResult, TObserved> = {}) {
    this.executions = [...(plan.executions ?? [])];
    this.observations = [...(plan.observations ?? [])];
    this.cancellations = [...(plan.cancellations ?? [])];
  }

  async setup(
    request: TargetClientSetupRequest<TConfig>,
  ): Promise<
    TargetClientObservation<TargetClientSession<TScenario, TResult, TObservation, TObserved>>
  > {
    this.record("setup", request.operationId, request, request.config);
    const session: TargetClientSession<TScenario, TResult, TObservation, TObserved> = {
      execute: (execution) => this.execute(execution),
      observe: (observation) => this.observe(observation),
      cancel: (cancellation) => this.cancel(cancellation),
      cleanup: (cleanup) => this.cleanup(cleanup),
    };

    return this.complete("setup", request.operationId, request, {
      outcome: "success",
      durationMs: this.plan.setupDurationMs ?? 0,
      value: session,
    });
  }

  private async execute(
    request: TargetClientExecutionRequest<TScenario>,
  ): Promise<TargetClientObservation<TResult>> {
    this.record("execute", request.operationId, request, request.scenario);
    return this.complete(
      "execute",
      request.operationId,
      request,
      this.executions.shift() ?? exhaustedStep,
    );
  }

  private async observe(
    request: TargetClientObservationRequest<TObservation>,
  ): Promise<TargetClientObservation<TObserved>> {
    this.record("observe", request.operationId, request, request.observation);
    return this.complete(
      "observe",
      request.operationId,
      request,
      this.observations.shift() ?? exhaustedStep,
    );
  }

  private async cancel(
    request: TargetClientCancellationRequest,
  ): Promise<TargetClientObservation<void>> {
    this.record("cancel", request.operationId, request, request.reason);
    return this.complete(
      "cancel",
      request.operationId,
      request,
      this.cancellations.shift() ?? { outcome: "success", durationMs: 0, value: undefined },
    );
  }

  private async cleanup(
    request: TargetClientCleanupRequest,
  ): Promise<TargetClientObservation<void>> {
    this.record("cleanup", request.operationId, request);
    this.cleanupCount = 1;
    return this.complete("cleanup", request.operationId, request, {
      outcome: "success",
      durationMs: this.plan.cleanupDurationMs ?? 0,
      value: undefined,
    });
  }

  private record(
    operation: TargetClientOperation,
    operationId: string,
    request: BoundedOperationRequest,
    input?: unknown,
  ): void {
    this.calls.push({ operation, operationId, timeoutMs: request.timeoutMs, input });
  }

  private complete<T>(
    operation: TargetClientOperation,
    operationId: string,
    request: BoundedOperationRequest,
    step: DeterministicFakeStep<T>,
  ): TargetClientObservation<T> {
    if (!Number.isFinite(step.durationMs) || step.durationMs < 0) {
      throw new RangeError("deterministic fake durationMs must be finite and non-negative");
    }

    const startedAtMs = this.currentTimeMs;
    const timedOut = step.durationMs > request.timeoutMs;
    const durationMs = timedOut ? request.timeoutMs : step.durationMs;
    this.currentTimeMs += durationMs;
    const timing = {
      operation,
      operationId,
      startedAtMs,
      endedAtMs: this.currentTimeMs,
      durationMs,
    };

    if (timedOut) {
      return {
        ...timing,
        outcome: "timeout",
        failure: {
          code: "deadline_exceeded",
          message: `operation exceeded ${request.timeoutMs}ms`,
        },
      };
    }

    return step.outcome === "success"
      ? { ...timing, outcome: "success", value: step.value }
      : { ...timing, outcome: step.outcome, failure: step.failure };
  }
}
