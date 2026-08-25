import { describe, expect, it, vi } from "vitest";

import type { Sleeper } from "../../src/delay.js";
import { createServer } from "../../src/server.js";
import { connectTestClient } from "../helpers/mcpTestClient.js";

describe("delay tool", () => {
  it("waits for the requested duration before responding", async () => {
    const wait = vi.fn(async () => undefined);
    const sleeper: Sleeper = { wait };
    const server = createServer(undefined, sleeper);
    const connection = await connectTestClient(server);

    try {
      const result = await connection.client.callTool({
        name: "delay",
        arguments: { delayMs: 250 },
      });

      expect(wait).toHaveBeenCalledOnce();
      expect(wait).toHaveBeenCalledWith(250, expect.any(AbortSignal));
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify({ status: "delayed", delayMs: 250 }) },
      ]);
    } finally {
      await connection.close();
    }
  });

  it("rejects delays above the safety limit", async () => {
    const wait = vi.fn(async () => undefined);
    const server = createServer(undefined, { wait });
    const connection = await connectTestClient(server);

    try {
      const result = await connection.client.callTool({
        name: "delay",
        arguments: { delayMs: 30_001 },
      });

      expect(result.isError).toBe(true);
      expect(wait).not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });
});
