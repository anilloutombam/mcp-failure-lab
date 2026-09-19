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

export const MAX_PENDING_DUPLICATE_RESPONSES = 128;

export interface DuplicateResponseFaults {
  activate(requestId: RequestId): void;
  apply(message: JSONRPCMessage, relatedRequestId?: RequestId): readonly JSONRPCMessage[];
  clear(): void;
}

export class RequestScopedDuplicateResponseFaults implements DuplicateResponseFaults {
  private readonly pending = new Set<RequestId>();

  activate(requestId: RequestId): void {
    if (!this.pending.has(requestId) && this.pending.size >= MAX_PENDING_DUPLICATE_RESPONSES) {
      throw new Error("Too many pending duplicate-response faults");
    }
    this.pending.add(requestId);
  }

  apply(message: JSONRPCMessage, relatedRequestId?: RequestId): readonly JSONRPCMessage[] {
    const requestId = relatedRequestId ?? responseId(message);
    if (requestId === undefined || !this.pending.delete(requestId)) return [message];
    return [message, structuredClone(message)];
  }

  clear(): void {
    this.pending.clear();
  }
}

export class DuplicateResponseTransport implements Transport {
  constructor(
    private readonly transport: Transport,
    private readonly faults: DuplicateResponseFaults,
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

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    for (const response of this.faults.apply(message, options?.relatedRequestId)) {
      await this.transport.send(response, options);
    }
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

export function registerDuplicateResponseTool(
  server: McpServer,
  faults: DuplicateResponseFaults,
): void {
  server.registerTool(
    "duplicate_response",
    {
      description: "Return the same JSON-RPC response twice for this request.",
      inputSchema: z.object({}),
    },
    async (_args, context) => {
      faults.activate(context.mcpReq.id);
      return { content: [{ type: "text", text: "duplicate response activated" }] };
    },
  );
}

function responseId(message: JSONRPCMessage): RequestId | undefined {
  return isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)
    ? message.id
    : undefined;
}
