import { describe, expect, it } from "vitest";

import {
  DeterministicFakeTargetClientAdapter,
  type DeterministicFakePlan,
} from "../../src/testing/deterministicFakeTargetClientAdapter.js";
import { boundedTimeoutMs } from "../../src/targetClientAdapter.js";

interface TestScenario {
  action: string;
}

function fake(plan: DeterministicFakePlan<string, string> = {}) {
  return new DeterministicFakeTargetClientAdapter<
    { endpoint: string },
    TestScenario,
    string,
    { probe: string },
    string
  >(plan);
}

describe("target-client adapter contract", () => {
  it("requires a positive finite integer timeout", () => {
    expect(() => boundedTimeoutMs(0)).toThrow(RangeError);
    expect(() => boundedTimeoutMs(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(boundedTimeoutMs(25)).toBe(25);
  });

  it("records setup, execution, observation, cancellation, and idempotent cleanup", async () => {
    const adapter = fake({
      executions: [{ outcome: "success", durationMs: 4, value: "executed" }],
      observations: [{ outcome: "success", durationMs: 2, value: "observed" }],
    });
    const setup = await adapter.setup({
      operationId: "setup-1",
      config: { endpoint: "in-memory" },
      timeoutMs: boundedTimeoutMs(10),
    });
    expect(setup.outcome).toBe("success");
    if (setup.outcome !== "success") throw new Error("expected fake setup to succeed");

    const session = setup.value;
    await session.execute({
      operationId: "run-1",
      scenario: { action: "exercise" },
      timeoutMs: boundedTimeoutMs(10),
    });
    await session.observe({
      operationId: "observe-1",
      observation: { probe: "state" },
      timeoutMs: boundedTimeoutMs(10),
    });
    await session.cancel({ operationId: "run-1", timeoutMs: boundedTimeoutMs(10) });
    await session.cleanup({ operationId: "cleanup-1", timeoutMs: boundedTimeoutMs(10) });
    await session.cleanup({ operationId: "cleanup-2", timeoutMs: boundedTimeoutMs(10) });

    expect(adapter.calls.map(({ operation }) => operation)).toEqual([
      "setup",
      "execute",
      "observe",
      "cancel",
      "cleanup",
      "cleanup",
    ]);
    expect(adapter.cleanupCount).toBe(1);
  });

  it.each(["error", "cancelled", "transport_loss"] as const)(
    "preserves the %s terminal outcome and structured failure",
    async (outcome) => {
      const adapter = fake({
        executions: [
          { outcome, durationMs: 3, failure: { code: "test_failure", message: outcome } },
        ],
      });
      const setup = await adapter.setup({
        operationId: "setup-1",
        config: { endpoint: "in-memory" },
        timeoutMs: boundedTimeoutMs(10),
      });
      if (setup.outcome !== "success") throw new Error("expected fake setup to succeed");

      const observation = await setup.value.execute({
        operationId: "run-1",
        scenario: { action: "exercise" },
        timeoutMs: boundedTimeoutMs(10),
      });

      expect(observation).toMatchObject({
        outcome,
        durationMs: 3,
        failure: { code: "test_failure", message: outcome },
      });
    },
  );

  it("deterministically converts work beyond the budget into a timeout", async () => {
    const adapter = fake({
      executions: [{ outcome: "success", durationMs: 20, value: "too late" }],
    });
    const setup = await adapter.setup({
      operationId: "setup-1",
      config: { endpoint: "in-memory" },
      timeoutMs: boundedTimeoutMs(10),
    });
    if (setup.outcome !== "success") throw new Error("expected fake setup to succeed");

    const observation = await setup.value.execute({
      operationId: "run-1",
      scenario: { action: "exercise" },
      timeoutMs: boundedTimeoutMs(5),
    });

    expect(observation).toMatchObject({
      outcome: "timeout",
      durationMs: 5,
      failure: { code: "deadline_exceeded" },
    });
  });

  it("returns a structured error when an execution or observation plan is exhausted", async () => {
    const adapter = fake();
    const setup = await adapter.setup({
      operationId: "setup-1",
      config: { endpoint: "in-memory" },
      timeoutMs: boundedTimeoutMs(10),
    });
    if (setup.outcome !== "success") throw new Error("expected fake setup to succeed");

    const execution = await setup.value.execute({
      operationId: "run-1",
      scenario: { action: "exercise" },
      timeoutMs: boundedTimeoutMs(10),
    });
    const observation = await setup.value.observe({
      operationId: "observe-1",
      observation: { probe: "state" },
      timeoutMs: boundedTimeoutMs(10),
    });

    expect(execution).toMatchObject({
      outcome: "error",
      failure: { code: "fake_plan_exhausted" },
    });
    expect(observation).toMatchObject({
      outcome: "error",
      failure: { code: "fake_plan_exhausted" },
    });
  });

  it("uses planned cancellation behavior and applies budgets to setup and cleanup", async () => {
    const setupTimeout = await fake({ setupDurationMs: 20 }).setup({
      operationId: "setup-timeout",
      config: { endpoint: "in-memory" },
      timeoutMs: boundedTimeoutMs(5),
    });
    expect(setupTimeout).toMatchObject({ outcome: "timeout", durationMs: 5 });

    const adapter = fake({
      cancellations: [
        {
          outcome: "cancelled",
          durationMs: 2,
          failure: { code: "cancel_acknowledged", message: "cancelled by target" },
        },
      ],
      cleanupDurationMs: 20,
    });
    const setup = await adapter.setup({
      operationId: "setup-1",
      config: { endpoint: "in-memory" },
      timeoutMs: boundedTimeoutMs(10),
    });
    if (setup.outcome !== "success") throw new Error("expected fake setup to succeed");

    const cancellation = await setup.value.cancel({
      operationId: "run-1",
      reason: "test complete",
      timeoutMs: boundedTimeoutMs(10),
    });
    const cleanup = await setup.value.cleanup({
      operationId: "cleanup-1",
      timeoutMs: boundedTimeoutMs(5),
    });

    expect(cancellation).toMatchObject({
      outcome: "cancelled",
      failure: { code: "cancel_acknowledged" },
    });
    expect(cleanup).toMatchObject({ outcome: "timeout", durationMs: 5 });
  });

  it("rejects invalid scripted durations", async () => {
    const adapter = fake({
      executions: [{ outcome: "success", durationMs: -1, value: "invalid" }],
    });
    const setup = await adapter.setup({
      operationId: "setup-1",
      config: { endpoint: "in-memory" },
      timeoutMs: boundedTimeoutMs(10),
    });
    if (setup.outcome !== "success") throw new Error("expected fake setup to succeed");

    await expect(
      setup.value.execute({
        operationId: "run-1",
        scenario: { action: "exercise" },
        timeoutMs: boundedTimeoutMs(10),
      }),
    ).rejects.toThrow("deterministic fake durationMs must be finite and non-negative");
  });
});
