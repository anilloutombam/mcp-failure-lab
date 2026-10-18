import {
  type JSONRPCMessage,
  type McpServer,
  type RequestId,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { responseId } from "./responseMessage.js";

export const INVALID_PROGRESS_VARIANTS = [
  "unknown-token",
  "regressing-progress",
  "after-completion",
] as const;
export type InvalidProgressVariant = (typeof INVALID_PROGRESS_VARIANTS)[number];
export const MAX_PENDING_PROGRESS_FAULTS = 128;

export interface InvalidProgressFaults {
  activateAfterCompletion(
    requestId: RequestId,
    progressToken: string | number,
    signal?: AbortSignal,
  ): void;
  takeAfterCompletion(message: JSONRPCMessage): JSONRPCMessage | undefined;
  clear(): void;
}

interface PendingProgressFault {
  token: string | number;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class RequestScopedInvalidProgressFaults implements InvalidProgressFaults {
  private readonly pending = new Map<RequestId, PendingProgressFault>();

  activateAfterCompletion(
    requestId: RequestId,
    progressToken: string | number,
    signal?: AbortSignal,
  ): void {
    if (this.pending.has(requestId)) {
      throw new Error(`A progress fault is already pending for request ${String(requestId)}`);
    }
    if (this.pending.size >= MAX_PENDING_PROGRESS_FAULTS) {
      throw new Error("Too many pending progress faults");
    }
    if (signal?.aborted) {
      throw new Error("Request was cancelled before progress fault activation");
    }
    const fault: PendingProgressFault = { token: progressToken };
    if (signal !== undefined) {
      fault.signal = signal;
      fault.onAbort = () => this.remove(requestId);
      signal.addEventListener("abort", fault.onAbort, { once: true });
    }
    this.pending.set(requestId, fault);
  }

  takeAfterCompletion(message: JSONRPCMessage): JSONRPCMessage | undefined {
    const requestId = responseId(message);
    if (requestId === undefined) return undefined;
    const fault = this.remove(requestId);
    return fault === undefined ? undefined : progressNotification(fault.token, 1);
  }

  clear(): void {
    for (const requestId of this.pending.keys()) this.remove(requestId);
  }

  private remove(requestId: RequestId): PendingProgressFault | undefined {
    const fault = this.pending.get(requestId);
    if (fault !== undefined) {
      this.pending.delete(requestId);
      if (fault.signal !== undefined && fault.onAbort !== undefined) {
        fault.signal.removeEventListener("abort", fault.onAbort);
      }
    }
    return fault;
  }
}

export class InvalidProgressTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport["onmessage"];

  constructor(
    private readonly delegate: Transport,
    private readonly faults: InvalidProgressFaults,
  ) {}

  async start(): Promise<void> {
    this.delegate.onclose = () => {
      this.faults.clear();
      this.onclose?.();
    };
    this.delegate.onerror = (error) => this.onerror?.(error);
    this.delegate.onmessage = (message, extra) => this.onmessage?.(message, extra);
    await this.delegate.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    await this.delegate.send(message, options);
    const lateNotification = this.faults.takeAfterCompletion(message);
    if (lateNotification !== undefined) {
      await this.delegate.send(lateNotification, options);
    }
  }

  async close(): Promise<void> {
    this.faults.clear();
    await this.delegate.close();
  }

  setProtocolVersion(version: string): void {
    this.delegate.setProtocolVersion?.(version);
  }

  setSupportedProtocolVersions(versions: string[]): void {
    this.delegate.setSupportedProtocolVersions?.(versions);
  }
}

export function registerInvalidProgressTool(
  server: McpServer,
  faults: InvalidProgressFaults,
): void {
  server.registerTool(
    "invalid_progress",
    {
      description:
        "Send one bounded progress-notification fault for this request; requires a client progress token.",
      inputSchema: z.object({ variant: z.enum(INVALID_PROGRESS_VARIANTS) }),
    },
    async ({ variant }, context) => {
      const token = context.mcpReq._meta?.progressToken;
      if (token === undefined) {
        return {
          isError: true,
          content: [{ type: "text", text: "A progress token is required for invalid_progress" }],
        };
      }

      switch (variant) {
        case "unknown-token": {
          const unknownToken =
            token === "mcp-failure-lab-unknown"
              ? "mcp-failure-lab-unknown-2"
              : "mcp-failure-lab-unknown";
          await context.mcpReq.notify(progressNotification(unknownToken, 1));
          break;
        }
        case "regressing-progress":
          await context.mcpReq.notify(progressNotification(token, 2));
          await context.mcpReq.notify(progressNotification(token, 1));
          break;
        case "after-completion":
          faults.activateAfterCompletion(context.mcpReq.id, token, context.mcpReq.signal);
          break;
      }
      return { content: [{ type: "text", text: `invalid progress: ${variant}` }] };
    },
  );
}

function progressNotification(
  token: string | number,
  progress: number,
): {
  jsonrpc: "2.0";
  method: "notifications/progress";
  params: { progressToken: string | number; progress: number; total: number };
} {
  return {
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: { progressToken: token, progress, total: 3 },
  };
}
