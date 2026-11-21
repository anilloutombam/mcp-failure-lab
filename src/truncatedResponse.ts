import type { Writable } from "node:stream";
import type {
  JSONRPCMessage,
  McpServer,
  RequestId,
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { responseId } from "./responseMessage.js";

export const MAX_PENDING_TRUNCATED_RESPONSES = 128;
export const MAX_TRUNCATED_PREFIX_BYTES = 256;
export const TRUNCATION_POINT = "after-result-key";
export const TRUNCATED_SSE_PREFIX = "event: message\ndata: ";

export interface TruncatedResponseFaults {
  activate(requestId: RequestId): void;
  take(message: JSONRPCMessage, relatedRequestId?: RequestId): string | undefined;
  clear(): void;
}

export class RequestScopedTruncatedResponseFaults implements TruncatedResponseFaults {
  private readonly pending = new Set<RequestId>();

  activate(requestId: RequestId): void {
    if (
      Buffer.byteLength(TRUNCATED_SSE_PREFIX + responsePrefix(requestId)) >
      MAX_TRUNCATED_PREFIX_BYTES
    ) {
      throw new Error("Truncated-response prefix exceeds the byte limit");
    }
    if (!this.pending.has(requestId) && this.pending.size >= MAX_PENDING_TRUNCATED_RESPONSES) {
      throw new Error("Too many pending truncated-response faults");
    }
    this.pending.add(requestId);
  }

  take(message: JSONRPCMessage, relatedRequestId?: RequestId): string | undefined {
    const id = relatedRequestId ?? responseId(message);
    if (id === undefined || !this.pending.delete(id)) return undefined;
    return responsePrefix(id);
  }

  clear(): void {
    this.pending.clear();
  }
}

function responsePrefix(id: RequestId): string {
  return `{"jsonrpc":"2.0","id":${JSON.stringify(id)},"result":`;
}

export class TruncatedStdioTransport implements Transport {
  constructor(
    private readonly transport: Transport,
    private readonly faults: TruncatedResponseFaults,
    private readonly output: Writable = process.stdout,
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
    const prefix = this.faults.take(message, options?.relatedRequestId);
    if (prefix === undefined) return this.transport.send(message, options);
    await new Promise<void>((resolve, reject) => {
      this.output.write(prefix, (error) => (error ? reject(error) : resolve()));
    });
    await this.close();
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

export function registerTruncatedResponseTool(
  server: McpServer,
  faults: TruncatedResponseFaults,
): void {
  server.registerTool(
    "truncated_response",
    {
      description: `End this response at the ${TRUNCATION_POINT} point.`,
      inputSchema: z.object({}),
    },
    async (_args, context) => {
      faults.activate(context.mcpReq.id);
      return { content: [{ type: "text", text: "truncated response activated" }] };
    },
  );
}
