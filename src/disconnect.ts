import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export type Disconnect = () => Promise<void>;

export function registerDisconnectTool(server: McpServer, disconnect: Disconnect): void {
  server.registerTool(
    "disconnect",
    {
      description: "Close the MCP transport before this request can receive a response.",
      inputSchema: z.object({}),
    },
    async () => {
      await disconnect();

      return {
        content: [{ type: "text", text: "transport disconnected" }],
      };
    },
  );
}
