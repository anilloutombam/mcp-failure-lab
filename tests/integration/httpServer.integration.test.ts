import { once } from "node:events";
import { createServer as createNodeServer } from "node:http";
import { createConnection } from "node:net";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import { startHttpServer } from "../../src/httpServer.js";

function createClient(): Client {
  return new Client(
    { name: "http-integration-test", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
}

describe("Streamable HTTP server", () => {
  it.each(["0.0.0.0", "0", "0.0", "0.0.0.00", "::", "::0", "0:0:0:0:0:0:0:0"])(
    "rejects wildcard bind host %s without an allowlist",
    async (host) => {
      await expect(startHttpServer({ host, port: 0, path: "/mcp" })).rejects.toThrow(
        "Wildcard HTTP bind hosts require an explicit public allowlist",
      );
    },
  );

  it.each(["/mcp path", "/café"])("rejects non-canonical endpoint path %s", async (path) => {
    await expect(startHttpServer({ host: "127.0.0.1", port: 0, path })).rejects.toThrow(
      "HTTP endpoint path must use its URL-encoded canonical form",
    );
  });

  it("initializes, discovers tools, invokes ping, and shuts down", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
    const client = createClient();

    try {
      await client.connect(new StreamableHTTPClientTransport(handle.url));

      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["ping", "delay", "hang", "disconnect"]),
      );

      const result = await client.callTool({ name: "ping", arguments: {} });
      expect(result.isError).not.toBe(true);
    } finally {
      await client.close();
      await handle.close();
    }

    await expect(fetch(handle.url)).rejects.toThrow();
  });

  it("routes only the configured endpoint and rejects an untrusted Origin", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/custom" });

    try {
      expect(await fetch(new URL("/mcp", handle.url))).toMatchObject({ status: 404 });
      expect(
        await fetch(handle.url, {
          headers: { origin: "https://example.com" },
        }),
      ).toMatchObject({ status: 403 });
    } finally {
      await handle.close();
    }
  });

  it("cancels a hanging call without breaking later requests", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
    const client = createClient();

    try {
      await client.connect(new StreamableHTTPClientTransport(handle.url));
      const controller = new AbortController();
      const hangingCall = client.callTool(
        { name: "hang", arguments: {} },
        { signal: controller.signal },
      );

      controller.abort();
      await expect(hangingCall).rejects.toThrow();
      const pingResult = await client.callTool({ name: "ping", arguments: {} });
      expect(pingResult.isError).not.toBe(true);
    } finally {
      await client.close();
      await handle.close();
    }
  });

  it("rejects requests already connected when shutdown starts", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
    const socket = createConnection(Number(handle.url.port), handle.url.hostname);
    socket.setEncoding("utf8");

    try {
      await once(socket, "connect");
      const responseChunks: string[] = [];
      const continueReceived = new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error);
        socket.once("error", onError);
        socket.on("data", (chunk: string) => {
          responseChunks.push(chunk);
          if (responseChunks.join("").includes("HTTP/1.1 100 Continue")) {
            socket.off("error", onError);
            resolve();
          }
        });
      });
      const connectionEnded = once(socket, "end");

      socket.write(
        [
          "POST /mcp HTTP/1.1",
          `Host: ${handle.url.host}`,
          "Content-Type: application/json",
          "Content-Length: 2",
          "Expect: 100-continue",
          "Connection: keep-alive",
          "",
          "",
        ].join("\r\n"),
      );
      await continueReceived;

      const firstClose = handle.close();
      socket.write(
        [
          "{}POST /mcp HTTP/1.1",
          `Host: ${handle.url.host}`,
          "Content-Type: application/json",
          "Content-Length: 2",
          "Connection: close",
          "",
          "{}",
        ].join("\r\n"),
      );
      await connectionEnded;
      await Promise.all([firstClose, handle.close()]);

      const response = responseChunks.join("");
      expect(response).toContain("HTTP/1.1 503 Service Unavailable");
      expect(response).toContain("Server shutting down");
    } finally {
      socket.destroy();
      await handle.close();
    }

    await expect(fetch(handle.url)).rejects.toThrow();
  });

  it("reports a port conflict without leaking the MCP handler", async () => {
    const occupied = createNodeServer();
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    const address = occupied.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP address");

    try {
      await expect(
        startHttpServer({ host: "127.0.0.1", port: address.port, path: "/mcp" }),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        occupied.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  });
});
