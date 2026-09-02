/** A finite, positive timeout created by {@link boundedTimeoutMs}. */
export type BoundedTimeoutMs = number & { readonly __boundedTimeoutMs: unique symbol };

export function boundedTimeoutMs(value: number): BoundedTimeoutMs {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new RangeError("timeoutMs must be a positive, finite integer");
  }

  return value as BoundedTimeoutMs;
}

export type TargetClientOperation = "setup" | "execute" | "observe" | "cancel" | "cleanup";
export type TargetClientOutcome = "success" | "error" | "timeout" | "cancelled" | "transport_loss";

export interface TargetClientFailure {
  message: string;
  code?: string;
  cause?: unknown;
}

interface TargetClientObservationBase {
  operation: TargetClientOperation;
  operationId: string;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
}

export type TargetClientObservation<TResult> =
  | (TargetClientObservationBase & { outcome: "success"; value: TResult })
  | (TargetClientObservationBase & {
      outcome: Exclude<TargetClientOutcome, "success">;
      failure: TargetClientFailure;
    });

export interface BoundedOperationRequest {
  /** Every adapter operation has an explicit caller-supplied time budget. */
  timeoutMs: BoundedTimeoutMs;
}

export interface TargetClientExecutionRequest<TScenario> extends BoundedOperationRequest {
  operationId: string;
  scenario: TScenario;
}

export interface TargetClientObservationRequest<TObservation> extends BoundedOperationRequest {
  operationId: string;
  observation: TObservation;
}

export interface TargetClientCancellationRequest extends BoundedOperationRequest {
  operationId: string;
  reason?: string;
}

export interface TargetClientCleanupRequest extends BoundedOperationRequest {
  operationId: string;
}

export interface TargetClientSession<TScenario, TResult, TObservation, TObserved> {
  execute(
    request: TargetClientExecutionRequest<TScenario>,
  ): Promise<TargetClientObservation<TResult>>;
  observe(
    request: TargetClientObservationRequest<TObservation>,
  ): Promise<TargetClientObservation<TObserved>>;
  cancel(request: TargetClientCancellationRequest): Promise<TargetClientObservation<void>>;

  /**
   * Releases resources owned by this session. Implementations must make cleanup idempotent:
   * repeated and concurrent calls have the same externally visible effect as one call.
   */
  cleanup(request: TargetClientCleanupRequest): Promise<TargetClientObservation<void>>;
}

export interface TargetClientSetupRequest<TConfig> extends BoundedOperationRequest {
  operationId: string;
  config: TConfig;
}

/**
 * Boundary between Failure Lab orchestration and a target MCP client.
 *
 * The orchestrator owns operation identifiers, time budgets, scenario data, and the complete
 * setup-to-cleanup lifecycle. The adapter owns only target-client resources created during setup
 * and exposes them through the returned session. The orchestrator must call cleanup after every
 * successful setup, including after execution, observation, or cancellation failures.
 *
 * Adapters translate client-specific behavior into observations. They must not select fault tools,
 * evaluate scenario expectations, or report results; those remain orchestration concerns.
 */
export interface TargetClientAdapter<TConfig, TScenario, TResult, TObservation, TObserved> {
  setup(
    request: TargetClientSetupRequest<TConfig>,
  ): Promise<
    TargetClientObservation<TargetClientSession<TScenario, TResult, TObservation, TObserved>>
  >;
}
