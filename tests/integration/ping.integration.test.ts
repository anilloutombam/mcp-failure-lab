import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Clock } from "../../src/ping.js";
import { createServer } from "../../src/server.js";
import { connectTestClient } from "../helpers/mcpTestClient.js";

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

    const connection = await connectTestClient(() => createServer(clock));

    try {
      const { tools } = await connection.client.listTools();

      expect(tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "ping",
          }),
          expect.objectContaining({
            name: "delay",
          }),
          expect.objectContaining({
            name: "hang",
          }),
          expect.objectContaining({
            name: "disconnect",
          }),
        ]),
      );

      const rawResult = await connection.client.callTool({
        name: "ping",
        arguments: {},
      });

      const result = pingToolResponseSchema.parse(rawResult);

      expect(result.isError).not.toBe(true);

      const [textContent] = result.content;

      expect(JSON.parse(textContent.text)).toEqual({
        status: "ok",
        timestamp: fixedTimestamp,
      });
    } finally {
      await connection.close();
    }
  });
});
