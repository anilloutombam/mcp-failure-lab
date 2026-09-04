import { performance } from "node:perf_hooks";
import {
  Client,
  SdkError,
  SdkErrorCode,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { z } from "zod";
import type { MonotonicClock, ScenarioCall } from "./scenario.js";
import { runExternalScenario } from "./externalScenario.js";
import type { TargetClientAdapter } from "./targetClientAdapter.js";
import type {
  TargetClientObservation,
  TargetClientOperation,
  TargetClientSession,
  TargetClientSetupRequest,
} from "./targetClientAdapter.js";
import type { ResolvedTargetClient, TargetClientAdapterProvider } from "./targetClientRegistry.js";

type McpScenarioAdapter = TargetClientAdapter<
  McpTargetConfig,
  ScenarioCall,
  CallToolResult,
  ScenarioCall,
  CallToolResult
>;

const CLIENT_INFO = { name: "mcp-failure-lab-external-runner", version: "0.1.0" } as const;

const httpConfigSchema = z
  .object({
    transport: z.literal("http"),
    url: z.url(),
    headers: z.record(z.string(), z.string()).optional(),
    headerEnv: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .superRefine((config, context) => {
    const url = new URL(config.url);
    const hasHeaders =
      Object.keys(config.headers ?? {}).length > 0 ||
      Object.keys(config.headerEnv ?? {}).length > 0;

    if (url.protocol === "https:") return;
    if (url.protocol === "http:" && isLoopbackHost(url.hostname) && !hasHeaders) return;

    context.addIssue({
      code: "custom",
      path: ["url"],
      message: hasHeaders
        ? "HTTP targets with headers must use HTTPS"
        : "cleartext HTTP is allowed only for loopback targets",
    });
  });

const stdioConfigSchema = z
  .object({
    transport: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    cwd: z.string().min(1).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const mcpTargetConfigSchema = z.discriminatedUnion("transport", [
  httpConfigSchema,
  stdioConfigSchema,
]);
export type McpTargetConfig = z.infer<typeof mcpTargetConfigSchema>;

export interface McpTransportFactory {
  create(config: McpTargetConfig): StreamableHTTPClientTransport | StdioClientTransport;
}

export class DefaultMcpTransportFactory implements McpTransportFactory {
  create(config: McpTargetConfig): StreamableHTTPClientTransport | StdioClientTransport {
    if (config.transport === "http") {
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: {
          headers: resolveHeaders(config.headers, config.headerEnv),
          redirect: "error",
        },
      });
    }
    return new StdioClientTransport({
      command: config.command,
      ...(config.args === undefined ? {} : { args: config.args }),
      ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
      ...(config.env === undefined ? {} : { env: config.env }),
    });
  }
}

export class McpTargetClientAdapter implements McpScenarioAdapter {
  constructor(
    private readonly transports: McpTransportFactory = new DefaultMcpTransportFactory(),
    private readonly clock: MonotonicClock = performance,
  ) {}

  async setup(
    request: TargetClientSetupRequest<McpTargetConfig>,
  ): Promise<
    TargetClientObservation<
      TargetClientSession<ScenarioCall, CallToolResult, ScenarioCall, CallToolResult>
    >
  > {
    const startedAtMs = this.clock.now();
    const client = new Client(CLIENT_INFO);
    try {
      await client.connect(this.transports.create(request.config), { timeout: request.timeoutMs });
      return this.success("setup", request.operationId, startedAtMs, this.createSession(client));
    } catch (error) {
      await client.close().catch(() => undefined);
      return this.failure("setup", request.operationId, startedAtMs, error);
    }
  }

  private createSession(
    client: Client,
  ): TargetClientSession<ScenarioCall, CallToolResult, ScenarioCall, CallToolResult> {
    let cleanup: Promise<TargetClientObservation<void>> | undefined;
    return {
      execute: (request) =>
        this.call(client, "execute", request.operationId, request.scenario, request.timeoutMs),
      observe: (request) =>
        this.call(client, "observe", request.operationId, request.observation, request.timeoutMs),
      cancel: (request) =>
        Promise.resolve(this.success("cancel", request.operationId, this.clock.now(), undefined)),
      cleanup: (request) => (cleanup ??= this.close(client, request.operationId)),
    };
  }

  private async call(
    client: Client,
    operation: "execute" | "observe",
    operationId: string,
    call: ScenarioCall,
    timeoutMs: number,
  ): Promise<TargetClientObservation<CallToolResult>> {
    const startedAtMs = this.clock.now();
    try {
      const result = await client.callTool(
        { name: call.tool, arguments: call.args },
        { timeout: timeoutMs },
      );
      return this.success(operation, operationId, startedAtMs, result);
    } catch (error) {
      return this.failure(operation, operationId, startedAtMs, error);
    }
  }

  private async close(client: Client, operationId: string): Promise<TargetClientObservation<void>> {
    const startedAtMs = this.clock.now();
    try {
      await client.close();
      return this.success("cleanup", operationId, startedAtMs, undefined);
    } catch (error) {
      return this.failure("cleanup", operationId, startedAtMs, error);
    }
  }

  private success<T>(
    operation: TargetClientOperation,
    operationId: string,
    startedAtMs: number,
    value: T,
  ): TargetClientObservation<T> {
    const endedAtMs = this.clock.now();
    return {
      operation,
      operationId,
      startedAtMs,
      endedAtMs,
      durationMs: endedAtMs - startedAtMs,
      outcome: "success",
      value,
    };
  }

  private failure(
    operation: TargetClientOperation,
    operationId: string,
    startedAtMs: number,
    error: unknown,
  ): TargetClientObservation<never> {
    const endedAtMs = this.clock.now();
    const outcome =
      error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout ? "timeout" : "error";
    return {
      operation,
      operationId,
      startedAtMs,
      endedAtMs,
      durationMs: endedAtMs - startedAtMs,
      outcome,
      failure: { message: errorMessage(error), cause: error },
    };
  }
}

export class McpTargetClientAdapterProvider implements TargetClientAdapterProvider {
  readonly name = "mcp";

  resolve(value: unknown): ResolvedTargetClient {
    const config = mcpTargetConfigSchema.parse(value);
    const adapter = new McpTargetClientAdapter();
    return {
      name: this.name,
      run: (scenario) => runExternalScenario(this.name, adapter, config, scenario),
    };
  }
}

function resolveHeaders(
  headers: Record<string, string> | undefined,
  headerEnv: Record<string, string> | undefined,
): Record<string, string> {
  const resolved = { ...headers };
  for (const [header, variable] of Object.entries(headerEnv ?? {})) {
    const value = process.env[variable];
    if (value === undefined)
      throw new Error(`environment variable ${variable} is required for header ${header}`);
    resolved[header] = value;
  }
  return resolved;
}

function isLoopbackHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") return true;
  const octets = hostname.split(".");
  return octets.length === 4 && octets[0] === "127" && octets.every(isIpv4Octet);
}

function isIpv4Octet(value: string): boolean {
  if (!/^\d{1,3}$/.test(value)) return false;
  const number = Number(value);
  return number >= 0 && number <= 255;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
