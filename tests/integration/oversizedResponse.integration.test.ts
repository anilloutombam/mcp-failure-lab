import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { MAX_RESPONSE_PAYLOAD_BYTES } from "../../src/oversizedResponse.js";
import { executeScenario } from "../../src/scenarioCommand.js";
import { createServer } from "../../src/server.js";
import { startHttpServer } from "../../src/httpServer.js";

describe("bounded oversized response", () => {
  it.each(["2025-11-25", "2026-07-28"] as const)(
    "returns exact ASCII byte counts and recovers on %s",
    async (protocolVersion) => {
      for (const sizeBytes of [0, 1024, MAX_RESPONSE_PAYLOAD_BYTES]) {
        const result = await executeScenario({
          name: "bounded response",
          protocolVersion,
          call: { tool: "oversized_response", args: { sizeBytes } },
          expect: { outcome: "success", result: { textBytes: sizeBytes } },
          observe: { call: { tool: "ping", args: {} }, expect: { outcome: "success" } },
        });
        expect(result.passed).toBe(true);
        const content = result.result?.content[0];
        expect(content?.type).toBe("text");
        if (content?.type === "text") {
          expect(Buffer.byteLength(content.text)).toBe(sizeBytes);
          expect(content.text).toBe("x".repeat(sizeBytes));
        }
      }
    },
  );

  it("rejects out-of-range and fractional sizes without affecting the next call", async () => {
    const server = createServer();
    const client = new Client(
      { name: "bounds-test", version: "1" },
      { supportedProtocolVersions: ["2025-11-25"], versionNegotiation: { mode: "legacy" } },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      for (const sizeBytes of [-1, 1.5, MAX_RESPONSE_PAYLOAD_BYTES + 1]) {
        const result = await client.callTool({
          name: "oversized_response",
          arguments: { sizeBytes },
        });
        expect(result.isError).toBe(true);
      }
      await expect(client.callTool({ name: "ping", arguments: {} })).resolves.toMatchObject({
        content: [{ type: "text" }],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("serves an exact payload on the public HTTP endpoint", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
    const client = new Client(
      { name: "oversized-http-test", version: "1" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    try {
      await client.connect(new StreamableHTTPClientTransport(handle.url));
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("oversized_response");
      const response = await client.callTool({
        name: "oversized_response",
        arguments: { sizeBytes: 16_384 },
      });
      const content = response.content[0];
      expect(content?.type).toBe("text");
      if (content?.type === "text") expect(Buffer.byteLength(content.text)).toBe(16_384);
      await expect(client.callTool({ name: "ping", arguments: {} })).resolves.toMatchObject({
        content: [{ type: "text" }],
      });
    } finally {
      await client.close();
      await handle.close();
    }
  });

  it("succeeds below a stdio client limit and rejects above it", async () => {
    const client = new Client(
      { name: "limited-stdio-test", version: "1" },
      { supportedProtocolVersions: ["2025-11-25"], versionNegotiation: { mode: "legacy" } },
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/cli.ts", "serve"],
      cwd: process.cwd(),
      stderr: "pipe",
      maxBufferSize: 4_096,
    });
    const transportErrors: Error[] = [];
    transport.onerror = (error) => transportErrors.push(error);
    try {
      await client.connect(transport);
      const below = await client.callTool(
        { name: "oversized_response", arguments: { sizeBytes: 1_024 } },
        { timeout: 2_000 },
      );
      expect(below.content[0]).toMatchObject({ type: "text", text: "x".repeat(1_024) });
      await expect(
        client.callTool(
          { name: "oversized_response", arguments: { sizeBytes: 8_192 } },
          { timeout: 2_000 },
        ),
      ).rejects.toThrow();
      expect(transportErrors.map((error) => error.message)).toContain(
        "ReadBuffer exceeded maximum size of 4096 bytes",
      );
    } finally {
      await client.close().catch(() => undefined);
    }
  });
});
