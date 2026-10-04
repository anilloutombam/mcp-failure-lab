import { setTimeout } from "node:timers/promises";

import {
  ProtocolError,
  ProtocolErrorCode,
  SdkError,
  SdkErrorCode,
  type McpServer,
  type RequestOptions,
} from "@modelcontextprotocol/server";
import { z } from "zod";

export const MAX_PROTOCOL_PING_DELAY_MS = 30_000;
export const MAX_LIVENESS_TIMEOUT_MS = 30_000;

export type ProtocolPingOutcome = "success" | "unsupported" | "invalid_response" | "timeout";
export type ProtocolPingSender = (options: RequestOptions) => Promise<unknown>;
export type CloseTransport = () => Promise<void>;
export interface ProtocolPingDiagnostic {
  requestId: string | number;
  protocolPing: { outcome: ProtocolPingOutcome };
  transport: {
    outcome: "retained" | "closure_requested" | "closed" | "close_failed" | "closure_unavailable";
  };
}
export type ProtocolPingRecorder = (diagnostic: ProtocolPingDiagnostic) => void;

export interface LivenessSleeper {
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
}

export interface ProtocolPingLivenessOptions {
  pingAfterMs: number;
  livenessTimeoutMs: number;
  completionDelayMs: number;
  closeOnFailure: boolean;
}

export interface ProtocolPingLivenessResult {
  status: "protocol_ping_succeeded" | "protocol_ping_failed";
  protocolPing: { outcome: ProtocolPingOutcome };
  transport: { outcome: "retained" | "closed" | "closure_unavailable" };
}

const systemSleeper: LivenessSleeper = {
  wait: async (delayMs, signal) => {
    await setTimeout(delayMs, undefined, { signal });
  },
};

function classifyPingFailure(error: unknown): Exclude<ProtocolPingOutcome, "success"> {
  if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) return "timeout";
  if (
    (error instanceof SdkError &&
      error.code === SdkErrorCode.MethodNotSupportedByProtocolVersion) ||
    (error instanceof ProtocolError && error.code === ProtocolErrorCode.MethodNotFound)
  ) {
    return "unsupported";
  }
  return "invalid_response";
}

export async function runProtocolPingLiveness(
  options: ProtocolPingLivenessOptions,
  signal: AbortSignal,
  sendProtocolPing: ProtocolPingSender,
  closeTransport: CloseTransport | undefined,
  sleeper: LivenessSleeper = systemSleeper,
  record: (diagnostic: Omit<ProtocolPingDiagnostic, "requestId">) => void = () => undefined,
): Promise<ProtocolPingLivenessResult> {
  await sleeper.wait(options.pingAfterMs, signal);

  let outcome: ProtocolPingOutcome;
  try {
    await sendProtocolPing({ timeout: options.livenessTimeoutMs, signal });
    outcome = "success";
  } catch (error) {
    if (signal.aborted) throw error;
    outcome = classifyPingFailure(error);
  }

  if (outcome === "success") {
    record({ protocolPing: { outcome }, transport: { outcome: "retained" } });
    await sleeper.wait(options.completionDelayMs, signal);
    return {
      status: "protocol_ping_succeeded",
      protocolPing: { outcome },
      transport: { outcome: "retained" },
    };
  }

  if (options.closeOnFailure && closeTransport !== undefined) {
    // Preserve evidence before closure can cancel the call and suppress its result.
    record({ protocolPing: { outcome }, transport: { outcome: "closure_requested" } });
    try {
      await closeTransport();
    } catch (error) {
      record({ protocolPing: { outcome }, transport: { outcome: "close_failed" } });
      throw error;
    }
  }

  const result: ProtocolPingLivenessResult = {
    status: "protocol_ping_failed",
    protocolPing: { outcome },
    transport: {
      outcome: options.closeOnFailure
        ? closeTransport === undefined
          ? "closure_unavailable"
          : "closed"
        : "retained",
    },
  };
  record(result);
  return result;
}

export function registerProtocolPingLivenessTool(
  server: McpServer,
  closeTransport: CloseTransport | undefined,
  sleeper: LivenessSleeper = systemSleeper,
  record: ProtocolPingRecorder = (diagnostic) =>
    console.error(JSON.stringify({ event: "protocol_ping_liveness", ...diagnostic })),
): void {
  server.registerTool(
    "protocol_ping_liveness",
    {
      description:
        "Send an MCP protocol ping during this in-flight call and apply a bounded liveness policy.",
      inputSchema: z.object({
        pingAfterMs: z.number().int().min(0).max(MAX_PROTOCOL_PING_DELAY_MS),
        livenessTimeoutMs: z.number().int().min(1).max(MAX_LIVENESS_TIMEOUT_MS),
        completionDelayMs: z.number().int().min(0).max(MAX_PROTOCOL_PING_DELAY_MS).default(0),
        closeOnFailure: z.boolean().default(false),
      }),
    },
    async (options, context) => {
      const result = await runProtocolPingLiveness(
        options,
        context.mcpReq.signal,
        (requestOptions) => context.mcpReq.send({ method: "ping" }, requestOptions),
        closeTransport,
        sleeper,
        (diagnostic) =>
          record({
            requestId: context.mcpReq.id,
            protocolPing: diagnostic.protocolPing,
            transport: diagnostic.transport,
          }),
      );

      return {
        isError: result.status === "protocol_ping_failed",
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  );
}
