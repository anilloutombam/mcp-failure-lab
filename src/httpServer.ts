import { AsyncLocalStorage } from "node:async_hooks";
import { createServer as createNodeServer, type Server as NodeServer } from "node:http";
import type { ServerResponse } from "node:http";

import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
  type NodeIncomingMessageLike,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { isCanonicalHttpPath, isWildcardHost } from "./httpValidation.js";
import { createServer } from "./server.js";

export interface HttpServerOptions {
  host: string;
  port: number;
  path: string;
}

export interface HttpServerHandle {
  url: URL;
  close(): Promise<void>;
}

function validationHostname(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function displayHostname(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

async function listen(server: NodeServer, options: HttpServerOptions): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port, options.host);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("HTTP server did not expose a TCP address");
  }
  return address.port;
}

export async function startHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  if (isWildcardHost(options.host)) {
    throw new Error("Wildcard HTTP bind hosts require an explicit public allowlist");
  }
  if (!isCanonicalHttpPath(options.path)) {
    throw new Error("HTTP endpoint path must use its URL-encoded canonical form");
  }

  const activeResponse = new AsyncLocalStorage<ServerResponse>();
  const handler = createMcpHandler(
    () =>
      createServer(undefined, undefined, async () => {
        activeResponse.getStore()?.destroy();
      }),
    {
      legacy: "stateless",
      onerror: (error) => console.error("Streamable HTTP request failed:", error),
    },
  );
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => console.error("Streamable HTTP adapter failed:", error),
  });
  const allowedHostname = validationHostname(options.host);
  const validateHost = hostHeaderValidation([allowedHostname]);
  const validateOrigin = originValidation([allowedHostname]);
  let closing = false;

  const server = createNodeServer((request, response) => {
    if (closing) {
      response.writeHead(503, {
        connection: "close",
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("Server shutting down");
      return;
    }

    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== options.path) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    if (!validateHost(request, response) || !validateOrigin(request, response)) {
      return;
    }

    // The adapter's structural request type is stricter than Node's equivalent optional fields.
    void activeResponse.run(response, () =>
      nodeHandler(request as unknown as NodeIncomingMessageLike, response),
    );
  });

  let port: number;
  try {
    port = await listen(server, options);
  } catch (error) {
    await handler.close();
    throw error;
  }

  const reportServerError = (error: Error): void => {
    console.error("HTTP server failed:", error);
  };
  server.on("error", reportServerError);

  let closed = false;
  let handlerClosed = false;
  let listenerClosed = false;
  let closePromise: Promise<void> | undefined;
  return {
    url: new URL(`http://${displayHostname(options.host)}:${port}${options.path}`),
    close: async () => {
      if (closed) return;
      if (closePromise !== undefined) return closePromise;

      closing = true;
      const listenerCleanup = listenerClosed
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            server.close((error) => (error === undefined ? resolve() : reject(error)));
            server.closeIdleConnections();
          }).then(() => {
            listenerClosed = true;
          });
      const handlerCleanup = handlerClosed
        ? Promise.resolve()
        : handler.close().then(() => {
            handlerClosed = true;
          });

      closePromise = Promise.all([listenerCleanup, handlerCleanup])
        .then(() => {
          server.off("error", reportServerError);
          closed = true;
        })
        .catch((error: unknown) => {
          closePromise = undefined;
          closing = listenerClosed || handlerClosed;
          throw error;
        });

      return closePromise;
    },
  };
}
