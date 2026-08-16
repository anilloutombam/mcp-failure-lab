#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { runScenarioCommand, type ReportFormat } from "./scenarioCommand.js";
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

function parseRunArguments(args: string[]): { path: string; format: ReportFormat } | undefined {
  const [path, ...options] = args;
  if (!path) {
    console.error(
      "Missing scenario file. Usage: mcp-failure-lab run <file> [--report console|json]",
    );
    return undefined;
  }

  let format: ReportFormat = "console";

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option !== "--report") {
      console.error(`Unknown run option: ${option}`);
      return undefined;
    }

    const value = options[index + 1];
    if (value !== "console" && value !== "json") {
      console.error("--report must be either console or json");
      return undefined;
    }

    format = value;
    index += 1;
  }

  return { path, format };
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
    if (!parsed) {
      process.exitCode = 1;
      return;
    }

    process.exitCode = await runScenarioCommand(parsed.path, parsed.format, {
      write: console.log,
      writeError: console.error,
    });
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
