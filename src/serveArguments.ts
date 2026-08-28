export type ServeTransport = "stdio" | "http";

export interface ServeOptions {
  transport: ServeTransport;
  host: string;
  port: number;
  path: string;
}

export const DEFAULT_SERVE_OPTIONS: ServeOptions = {
  transport: "stdio",
  host: "127.0.0.1",
  port: 3000,
  path: "/mcp",
};

export type ServeArgumentsResult =
  { ok: true; options: ServeOptions } | { ok: false; error: string };

function optionValue(args: string[], index: number): string | undefined {
  const value = args[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

export function parseServeArguments(args: string[]): ServeArgumentsResult {
  const options = { ...DEFAULT_SERVE_OPTIONS };
  const suppliedHttpOptions = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = optionValue(args, index);

    if (argument === "--transport") {
      if (value !== "stdio" && value !== "http") {
        return { ok: false, error: "--transport must be either stdio or http" };
      }
      options.transport = value;
      index += 1;
      continue;
    }

    if (argument === "--host") {
      if (
        value === undefined ||
        (isIP(value) === 0 && !/^(?=.{1,253}$)[a-z\d](?:[a-z\d.-]*[a-z\d])?$/iu.test(value))
      ) {
        return { ok: false, error: "--host must be a hostname or IP address without a port" };
      }
      if (value === "0.0.0.0" || value === "::") {
        return { ok: false, error: "--host must not be a wildcard address" };
      }
      options.host = value;
      suppliedHttpOptions.add(argument);
      index += 1;
      continue;
    }

    if (argument === "--port") {
      const port = value === undefined ? Number.NaN : Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        return { ok: false, error: "--port must be an integer between 1 and 65535" };
      }
      options.port = port;
      suppliedHttpOptions.add(argument);
      index += 1;
      continue;
    }

    if (argument === "--path") {
      if (
        value === undefined ||
        !value.startsWith("/") ||
        value.length > 1_024 ||
        value.includes("?") ||
        value.includes("#")
      ) {
        return {
          ok: false,
          error: "--path must be an absolute URL path without a query or fragment",
        };
      }
      options.path = value;
      suppliedHttpOptions.add(argument);
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown serve option: ${argument}` };
  }

  if (options.transport === "stdio" && suppliedHttpOptions.size > 0) {
    return { ok: false, error: "--host, --port, and --path require --transport http" };
  }

  return { ok: true, options };
}
import { isIP } from "node:net";
