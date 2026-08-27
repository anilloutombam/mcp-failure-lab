import { McpServer } from "@modelcontextprotocol/server";
import { registerDelayTool, type Sleeper } from "./delay.js";
import { registerDisconnectTool, type Disconnect } from "./disconnect.js";
import { registerHangTool } from "./hang.js";
import { registerPingTool, type Clock } from "./ping.js";
import { VERSION } from "./version.js";

export function createServer(clock?: Clock, sleeper?: Sleeper, disconnect?: Disconnect): McpServer {
  const server = new McpServer({
    name: "mcp-failure-lab",
    version: VERSION,
  });

  registerPingTool(server, clock);
  registerDelayTool(server, sleeper);
  registerHangTool(server);
  registerDisconnectTool(server, disconnect ?? (() => server.close()));

  return server;
}
