import { setTimeout } from "node:timers/promises";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const MAX_DELAY_MS = 30_000;

export interface Sleeper {
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
}

const systemSleeper: Sleeper = {
  wait: async (delayMs, signal) => {
    await setTimeout(delayMs, undefined, { signal });
  },
};

export function registerDelayTool(server: McpServer, sleeper: Sleeper = systemSleeper): void {
  server.registerTool(
    "delay",
    {
      description: "Delay a successful MCP response to test client timeout behavior.",
      inputSchema: {
        delayMs: z
          .number()
          .int()
          .min(0)
          .max(MAX_DELAY_MS)
          .describe("Response delay in milliseconds."),
      },
    },
    async ({ delayMs }, { signal }) => {
      await sleeper.wait(delayMs, signal);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "delayed", delayMs }),
          },
        ],
      };
    },
  );
}
