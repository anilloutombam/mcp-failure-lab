import type { JSONRPCMessage } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LATE_RESPONSE_DEADLINE_MS,
  MAX_PENDING_LATE_RESPONSES,
  ResponseAfterCancellationFaults,
} from "../../src/responseAfterCancellation.js";

afterEach(() => vi.useRealTimers());

describe("response-after-cancellation faults", () => {
  it("sends once for the cancelled request ID and consumes the activation", async () => {
    const sent: JSONRPCMessage[] = [];
    const faults = new ResponseAfterCancellationFaults({
      send: async (message) => {
        sent.push(message);
      },
    });
    const controller = new AbortController();
    const pending = faults.activate(0, controller.signal);

    faults.observeCancellation(0);
    faults.observeCancellation(0);

    await expect(pending).rejects.toThrow("Late response sent after cancellation");
    expect(sent).toEqual([
      {
        jsonrpc: "2.0",
        id: 0,
        result: { content: [{ type: "text", text: "response sent after cancellation" }] },
      },
    ]);
    expect(faults.pendingCount).toBe(0);
    expect(faults.consumeCompleted(0)).toBe(true);
    expect(faults.consumeCompleted(0)).toBe(false);
  });

  it("expires an activation if cancellation is never observed", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    const faults = new ResponseAfterCancellationFaults({ send });
    const pending = faults.activate(7, new AbortController().signal);
    const outcome = expect(pending).rejects.toThrow("late-response deadline");

    await vi.advanceTimersByTimeAsync(LATE_RESPONSE_DEADLINE_MS);

    await outcome;
    expect(send).not.toHaveBeenCalled();
    expect(faults.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears pending activations and abort listeners on shutdown", async () => {
    vi.useFakeTimers();
    const faults = new ResponseAfterCancellationFaults({ send: vi.fn(async () => undefined) });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = faults.activate(11, controller.signal);
    const outcome = expect(pending).rejects.toThrow("closed for request 11");

    faults.clear();

    await outcome;
    expect(faults.pendingCount).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds pending activations", async () => {
    const faults = new ResponseAfterCancellationFaults({ send: vi.fn(async () => undefined) });
    const pending = Array.from({ length: MAX_PENDING_LATE_RESPONSES }, (_, id) =>
      faults.activate(id, new AbortController().signal),
    );
    const outcomes = pending.map((promise) => promise.catch(() => undefined));

    expect(() => faults.activate("overflow", new AbortController().signal)).toThrow(
      "Too many pending late-response faults",
    );
    faults.clear();
    await Promise.all(outcomes);
  });
});
