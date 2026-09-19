import { describe, expect, it } from "vitest";
import { RequestScopedMalformedMessageFaults } from "../../src/malformedMessage.js";
import { applyMalformedMessageResponse } from "../../src/malformedMessageHttp.js";
import { RequestScopedDuplicateResponseFaults } from "../../src/duplicateResponse.js";

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

describe("duplicate HTTP responses", () => {
  it("converts a matching JSON response into two SSE events", async () => {
    const malformed = new RequestScopedMalformedMessageFaults();
    const duplicate = new RequestScopedDuplicateResponseFaults();
    duplicate.activate(7);
    const response = await applyMalformedMessageResponse(
      new Response('{"jsonrpc":"2.0","id":7,"result":{}}', {
        headers: { "content-type": "application/json" },
      }),
      malformed,
      duplicate,
    );

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expectDuplicateResponseEvents(await response.text(), 7);
  });

  it("duplicates a matching SSE response event", async () => {
    const malformed = new RequestScopedMalformedMessageFaults();
    const duplicate = new RequestScopedDuplicateResponseFaults();
    duplicate.activate(7);
    const response = await applyMalformedMessageResponse(
      new Response('event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{}}\n\n', {
        headers: { "content-type": "text/event-stream" },
      }),
      malformed,
      duplicate,
    );

    expectDuplicateResponseEvents(await response.text(), 7);
  });
});

function expectDuplicateResponseEvents(body: string, requestId: number): void {
  const events = body.split(/\r\n\r\n|\n\n|\r\r/).filter((event) => event.trim() !== "");
  expect(events).toHaveLength(2);

  for (const event of events) {
    const data = event
      .split(/\r\n|\n|\r/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    expect(JSON.parse(data)).toMatchObject({ jsonrpc: "2.0", id: requestId });
  }
}
