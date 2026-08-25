import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export interface Clock {
  now(): Date;
}

export interface PingResult {
  status: "ok";
  timestamp: string;
}

const systemClock: Clock = {
  now: () => new Date(),
};

export function createPingResult(clock: Clock = systemClock): PingResult {
  return {
    status: "ok",
    timestamp: clock.now().toISOString(),
  };
}

export function registerPingTool(server: McpServer, clock: Clock = systemClock): void {
  server.registerTool(
    "ping",
    {
      description: "Check whether the MCP server is responsive.",
      inputSchema: z.object({}),
    },
    async () => {
      const result = createPingResult(clock);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );
}
