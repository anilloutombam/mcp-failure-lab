#!/usr/bin/env node

import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { runCliCommand } from "./cliCommand.js";
import { runDemoCommand } from "./demoCommand.js";
import { startHttpServer } from "./httpServer.js";
import {
  DuplicateResponseTransport,
  RequestScopedDuplicateResponseFaults,
} from "./duplicateResponse.js";
import {
  MalformedMessageTransport,
  RequestScopedMalformedMessageFaults,
} from "./malformedMessage.js";
import { createServer } from "./server.js";
import type { ServeOptions } from "./serveArguments.js";

async function serve(options: ServeOptions): Promise<void> {
  const malformedMessageFaults = new RequestScopedMalformedMessageFaults();
  const duplicateResponseFaults = new RequestScopedDuplicateResponseFaults();
  const serverHandle =
    options.transport === "stdio"
      ? serveStdio(() => createServer({ malformedMessageFaults, duplicateResponseFaults }), {
          legacy: "serve",
          transport: new MalformedMessageTransport(
            new DuplicateResponseTransport(new StdioServerTransport(), duplicateResponseFaults),
            malformedMessageFaults,
          ),
        })
      : await startHttpServer(options).then((handle) => {
          console.error(`MCP Failure Lab listening at ${handle.url.toString()}`);
          return handle;
        });

  let shuttingDown = false;

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.error(`Received ${signal}; shutting down.`);

    await serverHandle.close();
    process.exitCode = 0;
  }

  function requestShutdown(signal: NodeJS.Signals): void {
    void shutdown(signal).catch((error: unknown) => {
      console.error(`Failed to shut down after ${signal}:`, error);
      process.exitCode = 1;
    });
  }

  process.once("SIGINT", () => {
    requestShutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    requestShutdown("SIGTERM");
  });
}

const output = {
  write: console.log,
  writeError: console.error,
};

runCliCommand(process.argv.slice(2), output, {
  serve,
  runDemo: runDemoCommand,
})
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error("Unexpected failure:", error);
    process.exitCode = 1;
  });
