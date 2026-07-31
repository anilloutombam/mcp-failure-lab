import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Clock } from "./ping.js";
import { registerPingTool } from "./ping.js";

export interface ServerDependencies {
  clock?: Clock;
}

export function createServer(dependencies: ServerDependencies = {}): McpServer {
  const server = new McpServer({
    name: "mcp-failure-lab",
    version: "0.1.0",
  });

  if (dependencies.clock) {
    registerPingTool(server, dependencies.clock);
  } else {
    registerPingTool(server);
  }

  return server;
}
