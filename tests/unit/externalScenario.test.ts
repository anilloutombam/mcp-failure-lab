import { describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { runExternalScenario } from "../../src/externalScenario.js";
import { DeterministicFakeTargetClientAdapter } from "../../src/testing/deterministicFakeTargetClientAdapter.js";
import {
  boundedTimeoutMs,
  type TargetClientAdapter,
  type TargetClientSession,
} from "../../src/targetClientAdapter.js";
import type { ScenarioCall } from "../../src/scenario.js";

const successfulResult: CallToolResult = {
  content: [{ type: "text", text: "ready" }],
};

const scenario = {
  name: "external target",
  call: { tool: "status", args: {} },
  timeoutMs: 25,
  expect: { outcome: "success" as const, result: { textContains: "ready" } },
};

type TestSession = TargetClientSession<ScenarioCall, CallToolResult, ScenarioCall, CallToolResult>;

function rejectingAdapter(
  rejectedOperation: "setup" | "execute" | "observe" | "cancel" | "cleanup",
): TargetClientAdapter<
  Record<string, never>,
  ScenarioCall,
  CallToolResult,
  ScenarioCall,
  CallToolResult
> {
  const success = <T>(
    operation: "setup" | "execute" | "observe" | "cancel" | "cleanup",
    operationId: string,
    value: T,
  ) => ({
    operation,
    operationId,
    startedAtMs: 0,
    endedAtMs: 1,
    durationMs: 1,
    outcome: "success" as const,
    value,
  });
  const reject = () => Promise.reject(new Error(`${rejectedOperation} rejected`));
  const session: TestSession = {
    execute: (request) => {
      if (rejectedOperation === "execute") return reject();
      if (rejectedOperation === "cancel") {
        return Promise.resolve({
          operation: "execute",
          operationId: request.operationId,
          startedAtMs: 0,
          endedAtMs: 25,
          durationMs: 25,
          outcome: "timeout",
          failure: { message: "execution timed out" },
        });
      }
      return Promise.resolve(success("execute", request.operationId, successfulResult));
    },
    observe: (request) =>
      rejectedOperation === "observe"
        ? reject()
        : Promise.resolve(success("observe", request.operationId, successfulResult)),
    cancel: (request) =>
      rejectedOperation === "cancel"
        ? reject()
        : Promise.resolve(success("cancel", request.operationId, undefined)),
    cleanup: (request) =>
      rejectedOperation === "cleanup"
        ? reject()
        : Promise.resolve(success("cleanup", request.operationId, undefined)),
  };

  return {
    setup: (request) =>
      rejectedOperation === "setup"
        ? reject()
        : Promise.resolve(success("setup", request.operationId, session)),
  };
}

describe("external scenario orchestration", () => {
  it("executes through an adapter and always cleans up", async () => {
    const adapter = new DeterministicFakeTargetClientAdapter<
      Record<string, never>,
      typeof scenario.call,
      CallToolResult,
      typeof scenario.call,
      CallToolResult
    >({ executions: [{ outcome: "success", durationMs: 3, value: successfulResult }] });

    const result = await runExternalScenario("fake", adapter, {}, scenario);

    expect(result).toMatchObject({ passed: true, outcome: "success" });
    expect(adapter.calls.map((call) => call.operation)).toEqual(["setup", "execute", "cleanup"]);
    expect(result.execution?.diagnostics.map(({ operation }) => operation)).toEqual([
      "setup",
      "execute",
      "cleanup",
    ]);
  });

  it("cancels a timed-out execution before cleanup", async () => {
    const adapter = new DeterministicFakeTargetClientAdapter<
      Record<string, never>,
      typeof scenario.call,
      CallToolResult,
      typeof scenario.call,
      CallToolResult
    >({ executions: [{ outcome: "success", durationMs: 50, value: successfulResult }] });

    const result = await runExternalScenario(
      "fake",
      adapter,
      {},
      {
        ...scenario,
        expect: { outcome: "timeout" },
      },
    );

    expect(result.passed).toBe(true);
    expect(adapter.calls.map((call) => call.operation)).toEqual([
      "setup",
      "execute",
      "cancel",
      "cleanup",
    ]);
  });

  it("keeps adapter setup failures distinct from assertion failures", async () => {
    const adapter = new DeterministicFakeTargetClientAdapter<
      Record<string, never>,
      typeof scenario.call,
      CallToolResult,
      typeof scenario.call,
      CallToolResult
    >({ setupDurationMs: 50 });

    const result = await runExternalScenario("fake", adapter, {}, scenario);

    expect(result).toMatchObject({ passed: false, outcome: "error", failures: [] });
    expect(result.error).toBeInstanceOf(Error);
    expect(result.execution?.diagnostics[0]).toMatchObject({
      operation: "setup",
      outcome: "timeout",
    });
  });

  it("reports cleanup failure separately from scenario assertions", async () => {
    const adapter = new DeterministicFakeTargetClientAdapter<
      Record<string, never>,
      typeof scenario.call,
      CallToolResult,
      typeof scenario.call,
      CallToolResult
    >({
      executions: [{ outcome: "success", durationMs: 3, value: successfulResult }],
      cleanupDurationMs: 50,
    });

    const result = await runExternalScenario("fake", adapter, {}, scenario);

    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(false);
    expect(result.execution).toMatchObject({ passed: false });
    expect(result.execution?.diagnostics.at(-1)).toMatchObject({
      operation: "cleanup",
      outcome: "timeout",
    });
  });

  it("records a rejected setup operation", async () => {
    const result = await runExternalScenario("rejecting", rejectingAdapter("setup"), {}, scenario);

    expect(result.execution?.diagnostics).toEqual([
      expect.objectContaining({
        operation: "setup",
        outcome: "error",
        message: "setup rejected",
      }),
    ]);
  });

  it.each(["execute", "cleanup"] as const)("records a rejected %s operation", async (operation) => {
    const result = await runExternalScenario(
      "rejecting",
      rejectingAdapter(operation),
      {},
      scenario,
    );

    expect(result.passed).toBe(false);
    expect(result.execution?.diagnostics).toContainEqual(
      expect.objectContaining({ operation, outcome: "error", message: `${operation} rejected` }),
    );
  });

  it("records a rejected observer operation", async () => {
    const result = await runExternalScenario(
      "rejecting",
      rejectingAdapter("observe"),
      {},
      {
        ...scenario,
        observe: {
          call: { tool: "status", args: {} },
          timeoutMs: boundedTimeoutMs(25),
          expect: { outcome: "success" },
        },
      },
    );

    expect(result.execution?.diagnostics).toContainEqual(
      expect.objectContaining({
        operation: "observe",
        outcome: "error",
        message: "observe rejected",
      }),
    );
  });

  it("records a rejected cancellation operation", async () => {
    const result = await runExternalScenario(
      "rejecting",
      rejectingAdapter("cancel"),
      {},
      {
        ...scenario,
        expect: { outcome: "timeout" },
      },
    );

    expect(result.passed).toBe(false);
    expect(result.execution?.diagnostics).toContainEqual(
      expect.objectContaining({
        operation: "cancel",
        outcome: "error",
        message: "cancel rejected",
      }),
    );
  });
});
