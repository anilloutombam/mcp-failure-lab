#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { runCliCommand } from "./cliCommand.js";
import { runDemoCommand } from "./demoCommand.js";
import { createServer } from "./server.js";

async function serve(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  let shuttingDown = false;

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.error(`Received ${signal}; shutting down.`);

    await server.close();
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

  await server.connect(transport);
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
