import type { JSONRPCMessage, Transport, TransportSendOptions } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import {
  DuplicateResponseTransport,
  MAX_PENDING_DUPLICATE_RESPONSES,
  RequestScopedDuplicateResponseFaults,
} from "../../src/duplicateResponse.js";

const RESPONSE = {
  jsonrpc: "2.0",
  id: 7,
  result: { content: [] },
} as const satisfies JSONRPCMessage;

describe("duplicate-response faults", () => {
  it("duplicates only the matching response once", () => {
    const faults = new RequestScopedDuplicateResponseFaults();
    faults.activate(7);

    const duplicated = faults.apply(RESPONSE);
    expect(duplicated).toEqual([RESPONSE, RESPONSE]);
    expect(duplicated[1]).not.toBe(RESPONSE);
    expect(faults.apply(RESPONSE)).toEqual([RESPONSE]);
  });

  it("does not affect unrelated responses", () => {
    const faults = new RequestScopedDuplicateResponseFaults();
    faults.activate(7);
    const unrelated = { ...RESPONSE, id: 8 } satisfies JSONRPCMessage;

    expect(faults.apply(unrelated)).toEqual([unrelated]);
    expect(faults.apply(RESPONSE)).toHaveLength(2);
  });

  it("bounds pending activations", () => {
    const faults = new RequestScopedDuplicateResponseFaults();
    for (let id = 0; id < MAX_PENDING_DUPLICATE_RESPONSES; id += 1) faults.activate(id);
    expect(() => faults.activate("overflow")).toThrow("Too many pending duplicate-response faults");
  });

  it("writes both responses through the transport", async () => {
    const delegate = new RecordingTransport();
    const faults = new RequestScopedDuplicateResponseFaults();
    const transport = new DuplicateResponseTransport(delegate, faults);
    faults.activate(7);

    await transport.send(RESPONSE, { relatedRequestId: 7 });
    expect(delegate.sent).toEqual([RESPONSE, RESPONSE]);
  });
});

class RecordingTransport implements Transport {
  readonly sent: JSONRPCMessage[] = [];
  async start(): Promise<void> {}
  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    this.sent.push(message);
  }
  async close(): Promise<void> {}
}
