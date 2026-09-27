import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export type SessionLossActivation = "during_request" | "after_response";

export interface SessionLossController {
  lose(activation: SessionLossActivation): Promise<void>;
}

export function registerSessionLossTool(
  server: McpServer,
  controller: SessionLossController,
): void {
  server.registerTool(
    "session_loss",
    {
      description: "Invalidate this HTTP session during or after the current request.",
      inputSchema: z.object({
        activation: z.enum(["during_request", "after_response"]),
      }),
    },
    async ({ activation }) => {
      await controller.lose(activation);
      return {
        content: [{ type: "text", text: `session loss activated ${activation}` }],
      };
    },
  );
}
