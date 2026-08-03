import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerPingTool, type Clock } from "./ping.js";

export function createServer(clock?: Clock): McpServer {
  const server = new McpServer({
    name: "mcp-failure-lab",
    version: "0.1.0",
  });

  registerPingTool(server, clock);

  return server;
}
