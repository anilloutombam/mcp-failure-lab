import { once } from "node:events";
import { createServer as createNodeServer } from "node:http";
import { createConnection } from "node:net";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SdkErrorCode } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { startHttpServer } from "../../src/httpServer.js";

function createClient(): Client {
  return new Client(
    { name: "http-integration-test", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
}

function createLegacyClient(name: string): Client {
  return new Client(
    { name, version: "0.1.0" },
    {
      supportedProtocolVersions: ["2025-11-25"],
      versionNegotiation: { mode: "legacy" },
    },
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

  it("formats an IPv6 loopback endpoint", async () => {
    const handle = await startHttpServer({ host: "::1", port: 0, path: "/mcp" });

    try {
      expect(handle.url.hostname).toBe("[::1]");
    } finally {
      await handle.close();
    }
  });

  it("initializes, discovers tools, invokes ping, and shuts down", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
    const client = createClient();

    try {
      await client.connect(new StreamableHTTPClientTransport(handle.url));

      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "ping",
          "delay",
          "hang",
          "disconnect",
          "malformed_message",
          "duplicate_response",
        ]),
      );
      expect(tools.map((tool) => tool.name)).not.toContain("session_loss");

      const result = await client.callTool({ name: "ping", arguments: {} });
      expect(result.isError).not.toBe(true);
    } finally {
      await client.close();
      await handle.close();
    }

    await expect(fetch(handle.url)).rejects.toThrow();
  });

  it("invalidates one legacy session after returning the activation response", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
    const affected = createLegacyClient("session-loss-affected");
    const healthy = createLegacyClient("session-loss-healthy");

    try {
      await affected.connect(new StreamableHTTPClientTransport(handle.url));
      await healthy.connect(new StreamableHTTPClientTransport(handle.url));
      const { tools } = await affected.listTools();
      expect(tools.map((tool) => tool.name)).toContain("session_loss");

      await expect(
        affected.callTool({
          name: "session_loss",
          arguments: { activation: "after_response" },
        }),
      ).resolves.toMatchObject({ content: [{ type: "text" }] });

      await expect(affected.callTool({ name: "ping", arguments: {} })).rejects.toThrow(
        /Session not found|404/,
      );
      await expect(healthy.callTool({ name: "ping", arguments: {} })).resolves.toMatchObject({
        content: [{ type: "text" }],
      });
    } finally {
      await affected.close().catch(() => undefined);
      await healthy.close().catch(() => undefined);
      await handle.close();
    }
  });

  it("invalidates one legacy session while the activation request is active", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
    const affected = createLegacyClient("active-session-loss-affected");
    const healthy = createLegacyClient("active-session-loss-healthy");

    try {
      await affected.connect(new StreamableHTTPClientTransport(handle.url));
      await healthy.connect(new StreamableHTTPClientTransport(handle.url));

      const activeResult = await affected
        .callTool(
          {
            name: "session_loss",
            arguments: { activation: "during_request" },
          },
          { timeout: 1_000 },
        )
        .then(
          (value) => ({ status: "resolved" as const, value }),
          (error: unknown) => ({ status: "rejected" as const, error }),
        );
      expect(activeResult.status).toBe("rejected");
      if (activeResult.status === "rejected") {
        expect(activeResult.error).not.toMatchObject({ code: SdkErrorCode.RequestTimeout });
      }
      await expect(affected.callTool({ name: "ping", arguments: {} })).rejects.toThrow(
        /Session not found|404/,
      );
      await expect(healthy.callTool({ name: "ping", arguments: {} })).resolves.toMatchObject({
        content: [{ type: "text" }],
      });
    } finally {
      await affected.close().catch(() => undefined);
      await healthy.close().catch(() => undefined);
      await handle.close();
    }
  });

  it.each(["2026-07-28", "2025-11-25"] as const)(
    "limits a malformed response to its activating HTTP request (%s)",
    async (version) => {
      const handle = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
      const client = new Client(
        { name: "http-malformed-test", version: "0.1.0" },
        {
          supportedProtocolVersions: [version],
          versionNegotiation:
            version === "2025-11-25" ? { mode: "legacy" } : { mode: { pin: version } },
        },
      );

      try {
        await client.connect(new StreamableHTTPClientTransport(handle.url));
        await expect(
          client.callTool(
            {
              name: "malformed_message",
              arguments: { variant: "invalid-jsonrpc-version" },
            },
            { timeout: 500 },
          ),
        ).rejects.toThrow();

        await expect(client.callTool({ name: "ping", arguments: {} })).resolves.toMatchObject({
          content: [{ type: "text" }],
        });
      } finally {
        await client.close();
        await handle.close();
      }
    },
  );

  it("returns a duplicate response without breaking the next HTTP request", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
    const client = createClient();

    try {
      await client.connect(new StreamableHTTPClientTransport(handle.url));
      await expect(
        client.callTool({ name: "duplicate_response", arguments: {} }),
      ).resolves.toMatchObject({ content: [{ type: "text" }] });
      await expect(client.callTool({ name: "ping", arguments: {} })).resolves.toMatchObject({
        content: [{ type: "text" }],
      });
    } finally {
      await client.close();
      await handle.close();
    }
  });

  it("emits two SSE events with the same request ID", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });

    try {
      const response = await fetch(handle.url, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 77,
          method: "tools/call",
          params: { name: "duplicate_response", arguments: {} },
        }),
      });
      const events = (await response.text())
        .split(/\r\n\r\n|\n\n|\r\r/)
        .filter((event) => event.trim() !== "");

      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(events).toHaveLength(2);
      const payloads = events.map((event) => {
        const data = event.split(/\r\n|\n|\r/).find((line) => line.startsWith("data:"));
        expect(data).toBeDefined();
        return JSON.parse(data?.slice(5).trimStart() ?? "") as unknown;
      });
      expect(payloads[0]).toMatchObject({ jsonrpc: "2.0", id: 77 });
      expect(payloads[1]).toEqual(payloads[0]);
    } finally {
      await handle.close();
    }
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
