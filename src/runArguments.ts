import type { ReportFormat } from "./scenarioCommand.js";

export type RunArguments =
  | { ok: true; path: string; format: ReportFormat }
  | { ok: false; error: string; format: ReportFormat };

export function parseRunArguments(args: string[]): RunArguments {
  const reportIndex = args.lastIndexOf("--report");
  const selectedReport = reportIndex === -1 ? undefined : args[reportIndex + 1];
  let format: ReportFormat = selectedReport === "json" ? "json" : "console";
  let path: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--report") {
      const value = args[index + 1];
      if (value !== "console" && value !== "json") {
        return { ok: false, error: "--report must be either console or json", format };
      }

      format = value;
      index += 1;
      continue;
    }

    if (argument?.startsWith("-")) {
      return { ok: false, error: `Unknown run option: ${argument}`, format };
    }

    if (path !== undefined) {
      return { ok: false, error: `Unexpected run argument: ${argument}`, format };
    }

    path = argument;
  }

  if (!path) {
    return {
      ok: false,
      error: "Missing scenario file. Usage: mcp-failure-lab run <file> [--report console|json]",
      format,
    };
  }

  return { ok: true, path, format };
}
