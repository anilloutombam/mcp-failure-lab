import { describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { runExternalScenario } from "../../src/externalScenario.js";
import { DeterministicFakeTargetClientAdapter } from "../../src/testing/deterministicFakeTargetClientAdapter.js";

const successfulResult: CallToolResult = {
  content: [{ type: "text", text: "ready" }],
};

const scenario = {
  name: "external target",
  call: { tool: "status", args: {} },
  timeoutMs: 25,
  expect: { outcome: "success" as const, result: { textContains: "ready" } },
};

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
});
