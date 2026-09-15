import {
  isJSONRPCErrorResponse,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type McpServer,
  type RequestId,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/server";
import { z } from "zod";

export const MALFORMED_MESSAGE_VARIANTS = [
  "missing-jsonrpc",
  "invalid-jsonrpc-version",
  "result-with-error",
] as const;

export type MalformedMessageVariant = (typeof MALFORMED_MESSAGE_VARIANTS)[number];
export const MAX_PENDING_MALFORMED_MESSAGE_FAULTS = 128;

export interface MalformedMessageFaults {
  activate(requestId: RequestId, variant: MalformedMessageVariant): void;
  apply(message: JSONRPCMessage, relatedRequestId?: RequestId): JSONRPCMessage;
  clear(): void;
}

export class RequestScopedMalformedMessageFaults implements MalformedMessageFaults {
  private readonly pending = new Map<RequestId, MalformedMessageVariant>();

  activate(requestId: RequestId, variant: MalformedMessageVariant): void {
    if (!this.pending.has(requestId) && this.pending.size >= MAX_PENDING_MALFORMED_MESSAGE_FAULTS) {
      throw new Error("Too many pending malformed-message faults");
    }
    this.pending.set(requestId, variant);
  }

  apply(message: JSONRPCMessage, relatedRequestId?: RequestId): JSONRPCMessage {
    const requestId = relatedRequestId ?? responseId(message);
    if (requestId === undefined) {
      return message;
    }

    const variant = this.pending.get(requestId);
    if (variant === undefined) {
      return message;
    }

    this.pending.delete(requestId);
    return corruptMessage(message, variant);
  }

  clear(): void {
    this.pending.clear();
  }
}

export class MalformedMessageTransport implements Transport {
  constructor(
    private readonly transport: Transport,
    private readonly faults: MalformedMessageFaults,
  ) {}

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport["onmessage"];

  async start(): Promise<void> {
    this.transport.onclose = () => this.onclose?.();
    this.transport.onerror = (error) => this.onerror?.(error);
    this.transport.onmessage = (message, extra) => this.onmessage?.(message, extra);
    await this.transport.start();
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    return this.transport.send(this.faults.apply(message, options?.relatedRequestId), options);
  }

  async close(): Promise<void> {
    this.faults.clear();
    await this.transport.close();
  }

  setProtocolVersion(version: string): void {
    this.transport.setProtocolVersion?.(version);
  }

  setSupportedProtocolVersions(versions: string[]): void {
    this.transport.setSupportedProtocolVersions?.(versions);
  }
}

export function registerMalformedMessageTool(
  server: McpServer,
  faults: MalformedMessageFaults,
): void {
  server.registerTool(
    "malformed_message",
    {
      description: "Return one deterministic response that violates a selected JSON-RPC rule.",
      inputSchema: z.object({
        variant: z.enum(MALFORMED_MESSAGE_VARIANTS),
      }),
    },
    async ({ variant }, context) => {
      faults.activate(context.mcpReq.id, variant);
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "fault-activated", variant }) }],
      };
    },
  );
}

function responseId(message: JSONRPCMessage): RequestId | undefined {
  return isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)
    ? message.id
    : undefined;
}

function corruptMessage(message: JSONRPCMessage, variant: MalformedMessageVariant): JSONRPCMessage {
  const malformed = { ...message } as Record<string, unknown>;

  switch (variant) {
    case "missing-jsonrpc":
      delete malformed.jsonrpc;
      break;
    case "invalid-jsonrpc-version":
      malformed.jsonrpc = "1.0";
      break;
    case "result-with-error":
      malformed.error = {
        code: -32603,
        message: "Injected response contains both result and error",
      };
      break;
  }

  return malformed as unknown as JSONRPCMessage;
}
