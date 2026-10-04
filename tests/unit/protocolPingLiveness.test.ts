import {
  ProtocolError,
  ProtocolErrorCode,
  SdkError,
  SdkErrorCode,
} from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import { runProtocolPingLiveness, type LivenessSleeper } from "../../src/protocolPingLiveness.js";

const immediateSleeper: LivenessSleeper = { wait: async () => undefined };
const options = {
  pingAfterMs: 20,
  livenessTimeoutMs: 40,
  completionDelayMs: 60,
  closeOnFailure: false,
};

describe("protocol ping liveness", () => {
  it("records the ping diagnosis before attempting closure and records a closure failure", async () => {
    const events: string[] = [];
    await expect(
      runProtocolPingLiveness(
        { ...options, closeOnFailure: true },
        new AbortController().signal,
        async () => {
          throw new SdkError(SdkErrorCode.RequestTimeout, "timeout");
        },
        async () => {
          events.push("close");
          throw new Error("close failed");
        },
        immediateSleeper,
        (diagnostic) =>
          events.push(`${diagnostic.protocolPing.outcome}:${diagnostic.transport.outcome}`),
      ),
    ).rejects.toThrow("close failed");
    expect(events).toEqual(["timeout:closure_requested", "close", "timeout:close_failed"]);
  });
  it("continues the call after a valid protocol ping response", async () => {
    const send = vi.fn(async () => ({}));
    const close = vi.fn(async () => undefined);

    await expect(
      runProtocolPingLiveness(options, new AbortController().signal, send, close, immediateSleeper),
    ).resolves.toEqual({
      status: "protocol_ping_succeeded",
      protocolPing: { outcome: "success" },
      transport: { outcome: "retained" },
    });
    expect(send).toHaveBeenCalledWith({
      timeout: options.livenessTimeoutMs,
      signal: expect.any(AbortSignal),
    });
    expect(close).not.toHaveBeenCalled();
  });

  it.each([
    [new SdkError(SdkErrorCode.RequestTimeout, "timed out"), "timeout"],
    [new ProtocolError(ProtocolErrorCode.MethodNotFound, "unsupported"), "unsupported"],
    [new SdkError(SdkErrorCode.InvalidResult, "bad result"), "invalid_response"],
  ] as const)(
    "records a failed protocol ping without closing by default",
    async (error, outcome) => {
      const close = vi.fn(async () => undefined);

      await expect(
        runProtocolPingLiveness(
          options,
          new AbortController().signal,
          async () => Promise.reject(error),
          close,
          immediateSleeper,
        ),
      ).resolves.toEqual({
        status: "protocol_ping_failed",
        protocolPing: { outcome },
        transport: { outcome: "retained" },
      });
      expect(close).not.toHaveBeenCalled();
    },
  );

  it("optionally closes the transport once after a liveness failure", async () => {
    const close = vi.fn(async () => undefined);

    await expect(
      runProtocolPingLiveness(
        { ...options, closeOnFailure: true },
        new AbortController().signal,
        async () => Promise.reject(new SdkError(SdkErrorCode.RequestTimeout, "timed out")),
        close,
        immediateSleeper,
      ),
    ).resolves.toMatchObject({ transport: { outcome: "closed" } });
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not classify or close after request cancellation", async () => {
    const controller = new AbortController();
    const close = vi.fn(async () => undefined);
    const cancellation = new Error("cancelled");

    await expect(
      runProtocolPingLiveness(
        options,
        controller.signal,
        async () => {
          controller.abort();
          throw cancellation;
        },
        close,
        immediateSleeper,
      ),
    ).rejects.toBe(cancellation);
    expect(close).not.toHaveBeenCalled();
  });
});
