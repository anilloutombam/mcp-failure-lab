#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { runScenarioCommand, writeScenarioCommandError } from "./scenarioCommand.js";
import { parseRunArguments } from "./runArguments.js";
import { createServer } from "./server.js";

const VERSION = "0.1.0";

function printHelp(): void {
  console.log(`
MCP Failure Lab

A chaos-engineering toolkit for testing MCP server resilience.

Usage:
  mcp-failure-lab <command> [options]

Commands:
  serve       Start the MCP server using stdio
  run <file>  Run a JSON scenario against MCP Failure Lab
  help        Show this help message

Options:
  --report <format>  Report format for run: console or json (default: console)
  -h, --help         Show this help message
  -v, --version      Show the current version
`);
}

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

async function main(args: string[]): Promise<void> {
  const [command, ...commandArgs] = args;

  if (!command || command === "help" || command === "-h" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "-v" || command === "--version") {
    console.log(VERSION);
    return;
  }

  if (command === "serve") {
    await serve();
    return;
  }

  if (command === "run") {
    const parsed = parseRunArguments(commandArgs);
    const output = {
      write: console.log,
      writeError: console.error,
    };

    if (!parsed.ok) {
      writeScenarioCommandError("invalid_arguments", parsed.error, parsed.format, output);
      process.exitCode = 1;
      return;
    }

    process.exitCode = await runScenarioCommand(parsed.path, parsed.format, output);
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Run with --help to see available commands.");
  process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error("Unexpected failure:", error);
  process.exitCode = 1;
});
