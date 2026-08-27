import { createServer as createNodeServer } from "node:http";

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
