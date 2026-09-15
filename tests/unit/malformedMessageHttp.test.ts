import { describe, expect, it } from "vitest";
import { RequestScopedMalformedMessageFaults } from "../../src/malformedMessage.js";
import { applyMalformedMessageResponse } from "../../src/malformedMessageHttp.js";

describe("malformed SSE responses", () => {
  it.each(["\n", "\r\n", "\r"])("handles chunked events with %j separators", async (newline) => {
    const faults = new RequestScopedMalformedMessageFaults();
    faults.activate(7, "missing-jsonrpc");
    const unrelated = 'data: {"jsonrpc":"2.0","id":8,"result":{}}';
    const event = [
      "id: response-7",
      "event: message",
      'data: {"jsonrpc":"2.0",',
      'data: "id":7,"result":{}}',
    ].join(newline);
    const source = `: keepalive${newline}${newline}${unrelated}${newline}${newline}${event}${newline}${newline}`;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const character of source) controller.enqueue(new TextEncoder().encode(character));
        controller.close();
      },
    });
    const response = await applyMalformedMessageResponse(
      new Response(body, {
        headers: { "content-type": "text/event-stream", "x-test": "retained" },
      }),
      faults,
    );
    const text = await response.text();
    expect(text).toContain(`: keepalive${newline}${newline}${unrelated}`);
    expect(text).toContain('id: response-7\nevent: message\ndata: {"id":7,"result":{}}');
    expect(response.headers.get("x-test")).toBe("retained");
  });
});
