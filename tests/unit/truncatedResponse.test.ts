import { PassThrough } from "node:stream";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_PENDING_TRUNCATED_RESPONSES,
  MAX_TRUNCATED_PREFIX_BYTES,
  RequestScopedTruncatedResponseFaults,
  TruncatedStdioTransport,
} from "../../src/truncatedResponse.js";

const response = (id: number): JSONRPCMessage => ({ jsonrpc: "2.0", id, result: {} });

describe("truncated-response faults", () => {
  it("consumes only the matching response once", () => {
    const faults = new RequestScopedTruncatedResponseFaults();
    faults.activate(7);

    expect(faults.take(response(8))).toBeUndefined();
    expect(faults.take(response(7))).toBe('{"jsonrpc":"2.0","id":7,"result":');
    expect(faults.take(response(7))).toBeUndefined();
  });

  it("bounds pending activations and emitted bytes", () => {
    const faults = new RequestScopedTruncatedResponseFaults();
    for (let id = 0; id < MAX_PENDING_TRUNCATED_RESPONSES; id += 1) faults.activate(id);
    expect(() => faults.activate("overflow")).toThrow("Too many pending truncated-response faults");
    faults.clear();
    expect(() => faults.activate("x".repeat(MAX_TRUNCATED_PREFIX_BYTES))).toThrow(
      "Truncated-response prefix exceeds the byte limit",
    );
    expect(faults.take(response(0))).toBeUndefined();
  });

  it("releases only the cancelled request and removes signal listeners", () => {
    const faults = new RequestScopedTruncatedResponseFaults();
    const cancelled = new AbortController();
    const completed = new AbortController();
    const removeCancelled = vi.spyOn(cancelled.signal, "removeEventListener");
    const removeCompleted = vi.spyOn(completed.signal, "removeEventListener");
    faults.activate(7, cancelled.signal);
    faults.activate(8, completed.signal);

    cancelled.abort();
    expect(faults.take(response(7))).toBeUndefined();
    expect(faults.take(response(8))).toBe('{"jsonrpc":"2.0","id":8,"result":');
    expect(removeCancelled).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(removeCompleted).toHaveBeenCalledWith("abort", expect.any(Function));

    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort();
    expect(() => faults.activate(9, alreadyCancelled.signal)).toThrow("cancelled");
    faults.activate(10, completed.signal);
    faults.clear();
    expect(removeCompleted).toHaveBeenCalledTimes(2);
    expect(faults.take(response(10))).toBeUndefined();
  });

  it("reclaims a pending slot after cancellation", () => {
    const faults = new RequestScopedTruncatedResponseFaults();
    const cancelled = new AbortController();
    faults.activate(0, cancelled.signal);
    for (let id = 1; id < MAX_PENDING_TRUNCATED_RESPONSES; id += 1) faults.activate(id);
    cancelled.abort();

    expect(() => faults.activate("replacement")).not.toThrow();
  });

  it("writes only the partial JSON bytes and closes stdio", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    const sent: JSONRPCMessage[] = [];
    let closed = false;
    const delegate: Transport = {
      start: async () => undefined,
      send: async (message) => {
        sent.push(message);
      },
      close: async () => {
        closed = true;
      },
    };
    const faults = new RequestScopedTruncatedResponseFaults();
    const transport = new TruncatedStdioTransport(delegate, faults, output);

    await transport.send(response(8));
    faults.activate(7);
    await transport.send(response(7));

    expect(sent).toEqual([response(8)]);
    expect(Buffer.concat(chunks).toString()).toBe('{"jsonrpc":"2.0","id":7,"result":');
    expect(closed).toBe(true);
    expect(faults.take(response(7))).toBeUndefined();
  });
});
