import type {
  JSONRPCMessage,
  MessageExtraInfo,
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import {
  MalformedMessageTransport,
  MAX_PENDING_MALFORMED_MESSAGE_FAULTS,
  RequestScopedMalformedMessageFaults,
  type MalformedMessageVariant,
} from "../../src/malformedMessage.js";

const RESPONSE = {
  jsonrpc: "2.0",
  id: 7,
  result: { content: [] },
} as const satisfies JSONRPCMessage;

describe("request-scoped malformed-message faults", () => {
  it.each<{
    variant: MalformedMessageVariant;
    expected: Record<string, unknown>;
  }>([
    {
      variant: "missing-jsonrpc",
      expected: { id: 7, result: { content: [] } },
    },
    {
      variant: "invalid-jsonrpc-version",
      expected: { jsonrpc: "1.0", id: 7, result: { content: [] } },
    },
    {
      variant: "result-with-error",
      expected: {
        ...RESPONSE,
        error: {
          code: -32603,
          message: "Injected response contains both result and error",
        },
      },
    },
  ])("applies $variant once to its matching response", ({ variant, expected }) => {
    const faults = new RequestScopedMalformedMessageFaults();
    faults.activate(7, variant);

    expect(faults.apply(RESPONSE)).toEqual(expected);
    expect(faults.apply(RESPONSE)).toBe(RESPONSE);
  });

  it("does not affect an unrelated request", () => {
    const faults = new RequestScopedMalformedMessageFaults();
    faults.activate(7, "missing-jsonrpc");

    const unrelated = { ...RESPONSE, id: 8 } satisfies JSONRPCMessage;
    expect(faults.apply(unrelated)).toBe(unrelated);
    expect(faults.apply(RESPONSE)).not.toHaveProperty("jsonrpc");
  });

  it("uses the transport request association when supplied", () => {
    const faults = new RequestScopedMalformedMessageFaults();
    faults.activate("request-a", "invalid-jsonrpc-version");

    expect(faults.apply(RESPONSE, "request-a")).toMatchObject({ jsonrpc: "1.0" });
  });

  it("bounds pending activations", () => {
    const faults = new RequestScopedMalformedMessageFaults();
    for (let id = 0; id < MAX_PENDING_MALFORMED_MESSAGE_FAULTS; id += 1) {
      faults.activate(id, "missing-jsonrpc");
    }

    expect(() => faults.activate("overflow", "missing-jsonrpc")).toThrow(
      "Too many pending malformed-message faults",
    );
  });
});

describe("malformed-message transport", () => {
  it("delegates lifecycle and mutates only outbound messages", async () => {
    const delegate = new RecordingTransport();
    const faults = new RequestScopedMalformedMessageFaults();
    const transport = new MalformedMessageTransport(delegate, faults);
    const onMessage = vi.fn();
    transport.onmessage = onMessage;

    await transport.start();
    delegate.receive(RESPONSE);
    faults.activate(7, "missing-jsonrpc");
    await transport.send(RESPONSE, { relatedRequestId: 7 });
    await transport.close();

    expect(onMessage).toHaveBeenCalledWith(RESPONSE, undefined);
    expect(delegate.sent).toEqual([{ id: 7, result: { content: [] } }]);
    expect(delegate.closed).toBe(true);
  });
});

class RecordingTransport implements Transport {
  readonly sent: JSONRPCMessage[] = [];
  closed = false;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    this.sent.push(message);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.onclose?.();
  }

  receive(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }
}
