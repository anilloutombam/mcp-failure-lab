#!/usr/bin/env node

const VERSION = "0.1.0";

function printHelp(): void {
  console.log(`
MCP Failure Lab

A chaos-engineering toolkit for testing MCP server resilience.

Usage:
  mcp-failure-lab <command> [options]

Commands:
  help        Show this help message

Options:
  -h, --help      Show this help message
  -v, --version   Show the current version
`);
}

function main(args: string[]): void {
  const [command] = args;

  if (!command || command === "help" || command === "-h" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "-v" || command === "--version") {
    console.log(VERSION);
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Run with --help to see available commands.");
  process.exitCode = 1;
}

main(process.argv.slice(2));
