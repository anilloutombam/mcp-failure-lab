import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Clock } from "../../src/ping.js";
import { createServer } from "../../src/server.js";

const pingToolResponseSchema = z.object({
  isError: z.boolean().optional(),
  content: z.tuple([
    z.object({
      type: z.literal("text"),
      text: z.string(),
    }),
  ]),
});

describe("ping MCP integration", () => {
  it("discovers and invokes ping through the MCP protocol", async () => {
    const fixedTimestamp = "2026-08-03T12:00:00.000Z";

    const clock: Clock = {
      now: () => new Date(fixedTimestamp),
    };

    const server = createServer(clock);

    const client = new Client({
      name: "mcp-failure-lab-integration-test",
      version: "0.1.0",
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const { tools } = await client.listTools();

      expect(tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "ping",
          }),
        ]),
      );

      const rawResult = await client.callTool(
        {
          name: "ping",
          arguments: {},
        },
        CallToolResultSchema,
      );

      const result = pingToolResponseSchema.parse(rawResult);

      expect(result.isError).not.toBe(true);

      const [textContent] = result.content;

      expect(JSON.parse(textContent.text)).toEqual({
        status: "ok",
        timestamp: fixedTimestamp,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
