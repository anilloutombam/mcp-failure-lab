import { McpServer } from "@modelcontextprotocol/server";
import { registerDelayTool, type Sleeper } from "./delay.js";
import { registerDisconnectTool, type Disconnect } from "./disconnect.js";
import { registerHangTool } from "./hang.js";
import {
  registerDuplicateResponseTool,
  type DuplicateResponseFaults,
} from "./duplicateResponse.js";
import { registerMalformedMessageTool, type MalformedMessageFaults } from "./malformedMessage.js";
import { registerPingTool, type Clock } from "./ping.js";
import {
  registerResponseAfterCancellationTool,
  type ResponseAfterCancellationFaults,
} from "./responseAfterCancellation.js";
import { VERSION } from "./version.js";

export interface ServerDependencies {
  clock?: Clock;
  sleeper?: Sleeper;
  disconnect?: Disconnect;
  malformedMessageFaults?: MalformedMessageFaults;
  duplicateResponseFaults?: DuplicateResponseFaults;
  responseAfterCancellationFaults?: ResponseAfterCancellationFaults;
}

export function createServer(dependencies: ServerDependencies = {}): McpServer {
  const server = new McpServer({
    name: "mcp-failure-lab",
    version: VERSION,
  });

  registerPingTool(server, dependencies.clock);
  registerDelayTool(server, dependencies.sleeper);
  registerHangTool(server);
  registerDisconnectTool(server, dependencies.disconnect ?? (() => server.close()));
  if (dependencies.malformedMessageFaults !== undefined) {
    registerMalformedMessageTool(server, dependencies.malformedMessageFaults);
  }
  if (dependencies.duplicateResponseFaults !== undefined) {
    registerDuplicateResponseTool(server, dependencies.duplicateResponseFaults);
  }
  if (dependencies.responseAfterCancellationFaults !== undefined) {
    registerResponseAfterCancellationTool(server, dependencies.responseAfterCancellationFaults);
  }

  return server;
}
