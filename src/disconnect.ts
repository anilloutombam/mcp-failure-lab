import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type Disconnect = () => Promise<void>;

export function registerDisconnectTool(server: McpServer, disconnect: Disconnect): void {
  server.registerTool(
    "disconnect",
    {
      description: "Close the MCP transport before this request can receive a response.",
      inputSchema: {},
    },
    async () => {
      await disconnect();

      return {
        content: [{ type: "text", text: "transport disconnected" }],
      };
    },
  );
}
