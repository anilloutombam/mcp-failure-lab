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
});
