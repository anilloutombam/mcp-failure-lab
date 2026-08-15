import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerDelayTool, type Sleeper } from "./delay.js";
import { registerDisconnectTool } from "./disconnect.js";
import { registerHangTool } from "./hang.js";
import { registerPingTool, type Clock } from "./ping.js";

export function createServer(clock?: Clock, sleeper?: Sleeper): McpServer {
  const server = new McpServer({
    name: "mcp-failure-lab",
    version: "0.1.0",
  });

  registerPingTool(server, clock);
  registerDelayTool(server, sleeper);
  registerHangTool(server);
  registerDisconnectTool(server, () => server.close());

  return server;
}
