import { AsyncLocalStorage } from "node:async_hooks";

import {
  createMcpHandler,
  type CreateMcpHandlerOptions,
  type McpHttpHandler,
  type McpServer,
} from "@modelcontextprotocol/server";

import {
  RequestScopedMalformedMessageFaults,
  type MalformedMessageFaults,
} from "./malformedMessage.js";

export type MalformedMessageServerFactory = (faults: MalformedMessageFaults) => McpServer;

export function createMalformedMessageHttpHandler(
  factory: MalformedMessageServerFactory,
  options: CreateMcpHandlerOptions,
): McpHttpHandler {
  const requestFaults = new AsyncLocalStorage<RequestScopedMalformedMessageFaults>();
  const handler = createMcpHandler(() => {
    const faults = requestFaults.getStore();
    if (faults === undefined) {
      throw new Error("Malformed-message request context is unavailable");
    }
    return factory(faults);
  }, options);

  return {
    close: handler.close,
    notify: handler.notify,
    bus: handler.bus,
    fetch: (request, requestOptions) => {
      const faults = new RequestScopedMalformedMessageFaults();
      return requestFaults.run(faults, async () => {
        const response = await handler.fetch(request, requestOptions);
        return applyMalformedMessageResponse(response, faults);
      });
    },
  };
}

export async function applyMalformedMessageResponse(
  response: Response,
  faults: MalformedMessageFaults,
): Promise<Response> {
  if (response.headers.get("content-type")?.includes("text/event-stream") && response.body) {
    return replaceResponseBody(response, transformSseResponse(response.body, faults));
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return response;
  }

  let message: Parameters<MalformedMessageFaults["apply"]>[0];
  try {
    message = JSON.parse(await response.clone().text()) as typeof message;
  } catch {
    return response;
  }
  const malformed = faults.apply(message);
  if (malformed === message) {
    return response;
  }

  return replaceResponseBody(response, JSON.stringify(malformed));
}

function replaceResponseBody(response: Response, body: BodyInit): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const MAX_SSE_EVENT_CHARACTERS = 1_048_576;
const SSE_EVENT_SEPARATOR = /(?:\r\n|(?<!\r)\n|\r(?!\n)){2}/;

function transformSseResponse(
  body: ReadableStream<Uint8Array>,
  faults: MalformedMessageFaults,
): ReadableStream<Uint8Array> {
  let pending = "";
  const decoder = new TextDecoder();
  return body
    .pipeThrough(
      new TransformStream<Uint8Array, string>({
        transform(chunk, controller) {
          controller.enqueue(decoder.decode(chunk, { stream: true }));
        },
        flush(controller) {
          controller.enqueue(decoder.decode());
        },
      }),
    )
    .pipeThrough(
      new TransformStream<string, string>({
        transform(chunk, controller) {
          pending += chunk;
          let separator = SSE_EVENT_SEPARATOR.exec(pending);
          while (separator !== null) {
            const event = pending.slice(0, separator.index);
            controller.enqueue(transformSseEvent(event, faults) + separator[0]);
            pending = pending.slice(separator.index + separator[0].length);
            separator = SSE_EVENT_SEPARATOR.exec(pending);
          }
          if (pending.length > MAX_SSE_EVENT_CHARACTERS) {
            throw new Error("SSE response event exceeds the malformed-message buffer limit");
          }
        },
        flush(controller) {
          if (pending !== "") controller.enqueue(pending);
          faults.clear();
        },
      }),
    )
    .pipeThrough(new TextEncoderStream());
}

function transformSseEvent(event: string, faults: MalformedMessageFaults): string {
  const lines = event.split(/\r\n|\r|\n/);
  const data = lines.filter((line) => line.startsWith("data:") || line === "data");
  if (data.length === 0) return event;

  let message: Parameters<MalformedMessageFaults["apply"]>[0];
  try {
    message = JSON.parse(
      data.map((line) => line.slice(5).replace(/^ /, "")).join("\n"),
    ) as typeof message;
  } catch {
    return event;
  }
  const malformed = faults.apply(message);
  if (malformed === message) return event;

  let replaced = false;
  return lines
    .flatMap((line) => {
      if (!line.startsWith("data:") && line !== "data") return [line];
      if (replaced) return [];
      replaced = true;
      return [`data: ${JSON.stringify(malformed)}`];
    })
    .join("\n");
}
