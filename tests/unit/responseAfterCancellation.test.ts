import type { JSONRPCMessage, McpServer, RequestId, Transport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LATE_RESPONSE_DEADLINE_MS,
  MAX_PENDING_LATE_RESPONSES,
  ResponseAfterCancellationFaults,
  ResponseAfterCancellationTransport,
  registerResponseAfterCancellationTool,
} from "../../src/responseAfterCancellation.js";

afterEach(() => vi.useRealTimers());

describe("response-after-cancellation faults", () => {
  it("rejects invalid activations", async () => {
    const faults = new ResponseAfterCancellationFaults({ send: vi.fn(async () => undefined) });
    const first = faults.activate(1, new AbortController().signal);
    const settled = first.catch(() => undefined);
    expect(() => faults.activate(1, new AbortController().signal)).toThrow(
      "already pending for request 1",
    );

    const aborted = new AbortController();
    aborted.abort();
    expect(() => faults.activate(2, aborted.signal)).toThrow(
      "cancelled before late-response activation",
    );

    faults.clear();
    await settled;
    expect(() => faults.activate(3, new AbortController().signal)).toThrow(
      "Late-response fault is closed",
    );
  });

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
    expect(faults.consumeResponse(0)).toBe(true);
    expect(faults.consumeResponse(0)).toBe(false);
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

  it("keeps completed IDs until their SDK responses are handled", async () => {
    const faults = new ResponseAfterCancellationFaults({ send: vi.fn(async () => undefined) });
    const pending = Array.from({ length: MAX_PENDING_LATE_RESPONSES }, (_, id) => {
      const call = faults.activate(id, new AbortController().signal);
      faults.observeCancellation(id);
      return call.catch(() => undefined);
    });
    await Promise.all(pending);

    expect(faults.pendingCount).toBe(0);
    expect(() => faults.activate("overflow", new AbortController().signal)).toThrow(
      "Too many pending late-response faults",
    );
    expect(faults.consumeResponse(0)).toBe(true);
    const next = faults.activate("next", new AbortController().signal);
    const settled = next.catch(() => undefined);
    faults.clear();
    await settled;
  });

  it("settles an activation if the connection closes during a send", async () => {
    let releaseSend!: () => void;
    let sendStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      sendStarted = resolve;
    });
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseSend = resolve;
          sendStarted();
        }),
    );
    const faults = new ResponseAfterCancellationFaults({ send });
    const pending = faults.activate(3, new AbortController().signal);
    const outcome = expect(pending).rejects.toThrow("closed for request 3");
    faults.observeCancellation(3);
    await started;

    faults.clear();
    await outcome;
    releaseSend();
    await Promise.resolve();

    expect(faults.pendingCount).toBe(0);
    expect(faults.consumeResponse(3)).toBe(false);
  });

  it("does not start a queued send after the connection closes", async () => {
    const send = vi.fn(async () => undefined);
    const faults = new ResponseAfterCancellationFaults({ send });
    const pending = faults.activate(6, new AbortController().signal);
    const outcome = expect(pending).rejects.toThrow("closed for request 6");

    faults.observeCancellation(6);
    faults.clear();

    await outcome;
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
  });

  it("settles a blocked send at the deadline but tracks it until completion", async () => {
    vi.useFakeTimers();
    let releaseSend!: () => void;
    const faults = new ResponseAfterCancellationFaults({
      send: () =>
        new Promise<void>((resolve) => {
          releaseSend = resolve;
        }),
    });
    const pending = faults.activate(7, new AbortController().signal);
    const outcome = expect(pending).rejects.toThrow("send did not complete before the deadline");
    faults.observeCancellation(7);
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(LATE_RESPONSE_DEADLINE_MS);
    await outcome;
    expect(faults.pendingCount).toBe(1);
    expect(faults.consumeResponse(7)).toBe(true);

    releaseSend();
    await vi.advanceTimersByTimeAsync(0);
    expect(faults.pendingCount).toBe(0);
    expect(faults.consumeResponse(7)).toBe(false);
  });

  it("keeps a sending response tracked if activation cleanup races cancellation", async () => {
    let releaseSend!: () => void;
    let sendStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      sendStarted = resolve;
    });
    const faults = new ResponseAfterCancellationFaults({
      send: () =>
        new Promise<void>((resolve) => {
          releaseSend = resolve;
          sendStarted();
        }),
    });
    const pending = faults.activate(4, new AbortController().signal);
    const outcome = expect(pending).rejects.toThrow("Late response sent after cancellation");

    faults.observeCancellation(4);
    await started;
    faults.cancel(4);
    expect(faults.pendingCount).toBe(1);

    releaseSend();
    await outcome;
    expect(faults.consumeResponse(4)).toBe(true);
  });

  it("does not keep a completed marker after a failed send", async () => {
    const faults = new ResponseAfterCancellationFaults({
      send: async () => {
        throw new Error("output closed");
      },
    });
    const pending = faults.activate(5, new AbortController().signal);
    faults.observeCancellation(5);

    await expect(pending).rejects.toThrow("output closed");
    expect(faults.pendingCount).toBe(0);
    expect(faults.consumeResponse(5)).toBe(false);
  });

  it("cancels an activation before sending", async () => {
    const send = vi.fn(async () => undefined);
    const faults = new ResponseAfterCancellationFaults({ send });
    const pending = faults.activate(10, new AbortController().signal);
    faults.cancel(10);

    await expect(pending).rejects.toThrow("activation failed for request 10");
    expect(send).not.toHaveBeenCalled();
    expect(faults.pendingCount).toBe(0);
  });

  it("forwards healthy responses but suppresses the framework response for the fault", async () => {
    const sent: JSONRPCMessage[] = [];
    const delegate: Transport = {
      onmessage: undefined,
      onclose: undefined,
      start: async () => undefined,
      send: async (message) => {
        sent.push(message);
      },
      close: async () => undefined,
    };
    const faults = new ResponseAfterCancellationFaults({ send: delegate.send });
    const transport = new ResponseAfterCancellationTransport(delegate, faults);
    const received = vi.fn();
    transport.onmessage = received;
    await transport.start();

    const pending = faults.activate(0, new AbortController().signal);
    const outcome = expect(pending).rejects.toThrow("Late response sent after cancellation");
    const cancellation = {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 0, reason: "test" },
    } as const satisfies JSONRPCMessage;
    delegate.onmessage?.(cancellation);
    await outcome;

    const frameworkResponse = {
      jsonrpc: "2.0",
      id: 0,
      result: {},
    } as const satisfies JSONRPCMessage;
    const healthyResponse = { jsonrpc: "2.0", id: 1, result: {} } as const satisfies JSONRPCMessage;
    await transport.send(frameworkResponse);
    await transport.send(healthyResponse);
    expect(received).toHaveBeenCalledWith(cancellation, undefined);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ id: 0 });
    expect(sent[1]).toEqual(healthyResponse);
    await transport.close();
  });

  it("uses the result shape for the negotiated protocol version", async () => {
    const sent: JSONRPCMessage[] = [];
    const delegate: Transport = {
      start: async () => undefined,
      send: async (message) => {
        sent.push(message);
      },
      close: async () => undefined,
    };
    const faults = new ResponseAfterCancellationFaults({ send: delegate.send });
    const transport = new ResponseAfterCancellationTransport(delegate, faults);

    transport.setProtocolVersion("2026-07-28");
    const modern = faults.activate(8, new AbortController().signal);
    faults.observeCancellation(8);
    await modern.catch(() => undefined);

    transport.setProtocolVersion("2025-11-25");
    const legacy = faults.activate(9, new AbortController().signal);
    faults.observeCancellation(9);
    await legacy.catch(() => undefined);

    expect(sent[0]).toMatchObject({ result: { resultType: "complete" } });
    expect(sent[1]).not.toHaveProperty("result.resultType");
    await transport.close();
  });

  it("forwards transport lifecycle events and supported versions", async () => {
    const delegate: Transport = {
      start: async () => undefined,
      send: async () => undefined,
      close: async () => undefined,
      setSupportedProtocolVersions: vi.fn(),
    };
    const faults = new ResponseAfterCancellationFaults({ send: delegate.send });
    const transport = new ResponseAfterCancellationTransport(delegate, faults);
    transport.onclose = vi.fn();
    transport.onerror = vi.fn();
    await transport.start();

    delegate.onerror?.(new Error("transport failed"));
    transport.setSupportedProtocolVersions(["2026-07-28", "2025-11-25"]);
    delegate.onclose?.();

    expect(transport.onerror).toHaveBeenCalledWith(
      expect.objectContaining({ message: "transport failed" }),
    );
    expect(transport.onclose).toHaveBeenCalledOnce();
    expect(delegate.setSupportedProtocolVersions).toHaveBeenCalledWith([
      "2026-07-28",
      "2025-11-25",
    ]);
  });

  it("registers the tool and reports activation before cancellation", async () => {
    let handler: ToolHandler | undefined;
    const server = {
      registerTool: vi.fn((_name, _config, callback) => {
        handler = callback as unknown as ToolHandler;
      }),
    } as unknown as McpServer;
    const faults = new ResponseAfterCancellationFaults({ send: vi.fn(async () => undefined) });
    const notify = vi.fn(async () => undefined);
    const controller = new AbortController();
    registerResponseAfterCancellationTool(server, faults);

    const call = handler?.({}, requestContext(12, controller.signal, notify, "progress-12"));
    expect(call).toBeDefined();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
    faults.observeCancellation(12);
    await expect(call).rejects.toThrow("Late response sent after cancellation");
  });

  it("cleans up the activation when progress notification fails", async () => {
    let handler: ToolHandler | undefined;
    const server = {
      registerTool: vi.fn((_name, _config, callback) => {
        handler = callback as unknown as ToolHandler;
      }),
    } as unknown as McpServer;
    const faults = new ResponseAfterCancellationFaults({ send: vi.fn(async () => undefined) });
    registerResponseAfterCancellationTool(server, faults);

    await expect(
      handler?.(
        {},
        requestContext(
          13,
          new AbortController().signal,
          vi.fn(async () => Promise.reject(new Error("progress failed"))),
          "progress-13",
        ),
      ),
    ).rejects.toThrow("progress failed");
    expect(faults.pendingCount).toBe(0);
  });
});

type ToolHandler = (
  args: Record<string, never>,
  context: ReturnType<typeof requestContext>,
) => Promise<unknown>;

function requestContext(
  id: RequestId,
  signal: AbortSignal,
  notify: (message: unknown) => Promise<void>,
  progressToken?: string,
) {
  return {
    mcpReq: {
      id,
      signal,
      _meta: progressToken === undefined ? undefined : { progressToken },
      notify,
    },
  };
}
