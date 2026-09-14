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
        return applyFaultToJsonResponse(response, faults);
      });
    },
  };
}

async function applyFaultToJsonResponse(
  response: Response,
  faults: MalformedMessageFaults,
): Promise<Response> {
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

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(malformed), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
