import { parseRunArguments } from "./runArguments.js";
import { parseServeArguments, type ServeOptions } from "./serveArguments.js";
import {
  runScenarioCommand,
  writeScenarioCommandError,
  type ScenarioCommandOutput,
} from "./scenarioCommand.js";
import { VERSION } from "./version.js";

export interface CliDependencies {
  serve(options: ServeOptions): Promise<void>;
  runDemo(output: ScenarioCommandOutput): Promise<number>;
}

function printHelp(output: ScenarioCommandOutput): void {
  output.write(`
MCP Failure Lab

A chaos-engineering toolkit for testing MCP server resilience.

Usage:
mcp-failure-lab <command> [options]

Commands:
  serve       Start the MCP server (stdio by default)
  run <file>  Run a JSON scenario against MCP Failure Lab
  demo        Run a built-in deterministic delay scenario
  help        Show this help message

Options:
  --transport <type>  Transport for serve: stdio or http (default: stdio)
  --host <host>       HTTP bind host (default: 127.0.0.1)
  --port <port>       HTTP bind port (default: 3000)
  --path <path>       HTTP endpoint path (default: /mcp)
  --report <format>   Report format for run: console or json (default: console)
  --target <file>     Run against an HTTP or stdio MCP target configuration
  -h, --help         Show this help message
  -v, --version      Show the current version
`);
}

export async function runCliCommand(
  args: string[],
  output: ScenarioCommandOutput,
  dependencies: CliDependencies,
): Promise<number> {
  const [command, ...commandArgs] = args;

  switch (command) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      printHelp(output);
      return 0;

    case "-v":
    case "--version":
      output.write(VERSION);
      return 0;

    case "serve": {
      const parsed = parseServeArguments(commandArgs);
      if (!parsed.ok) {
        output.writeError(parsed.error);
        return 1;
      }
      await dependencies.serve(parsed.options);
      return 0;
    }

    case "demo":
      return dependencies.runDemo(output);

    case "run": {
      const parsed = parseRunArguments(commandArgs);

      if (!parsed.ok) {
        writeScenarioCommandError("invalid_arguments", parsed.error, parsed.format, output);
        return 1;
      }

      return runScenarioCommand(parsed.path, parsed.format, output, parsed.target);
    }

    default:
      output.writeError(`Unknown command: ${command}`);
      output.writeError("Run with --help to see available commands.");
      return 1;
  }
}
