import {
  isJSONRPCNotification,
  isJSONRPCResponse,
  type JSONRPCMessage,
  type McpServer,
  type RequestId,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/server";
import { z } from "zod";

export const MAX_PENDING_LATE_RESPONSES = 128;
export const LATE_RESPONSE_DEADLINE_MS = 5_000;

export interface LateResponseSender {
  send(message: JSONRPCMessage): Promise<void>;
}

interface PendingResponse {
  signal: AbortSignal;
  timer: ReturnType<typeof setTimeout>;
  onAbort(): void;
  reject(error: Error): void;
  sending: boolean;
}

/** Tracks calls waiting for cancellation and sends their responses over stdio. */
export class ResponseAfterCancellationFaults {
  private readonly pending = new Map<RequestId, PendingResponse>();
  private readonly completed = new Set<RequestId>();
  private closed = false;

  constructor(private readonly sender: LateResponseSender) {}

  activate(requestId: RequestId, signal: AbortSignal): Promise<never> {
    if (this.closed) {
      throw new Error("Late-response fault is closed");
    }
    if (this.pending.has(requestId) || this.completed.has(requestId)) {
      throw new Error(`A late response is already pending for request ${String(requestId)}`);
    }
    if (this.pending.size + this.completed.size >= MAX_PENDING_LATE_RESPONSES) {
      throw new Error("Too many pending late-response faults");
    }
    if (signal.aborted) {
      throw new Error("Request was cancelled before late-response activation");
    }

    return new Promise<never>((_, reject) => {
      const cleanup = (): void => {
        const pending = this.pending.get(requestId);
        if (pending === undefined) return;
        clearTimeout(pending.timer);
        signal.removeEventListener("abort", pending.onAbort);
        this.pending.delete(requestId);
      };
      const onAbort = (): void => this.observeCancellation(requestId);
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Cancellation was not observed before the late-response deadline"));
      }, LATE_RESPONSE_DEADLINE_MS);
      this.pending.set(requestId, { signal, timer, onAbort, reject, sending: false });
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  observeCancellation(requestId: RequestId): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined || pending.sending) return;
    pending.sending = true;
    clearTimeout(pending.timer);
    pending.signal.removeEventListener("abort", pending.onAbort);
    void Promise.resolve()
      .then(() =>
        this.sender.send({
          jsonrpc: "2.0",
          id: requestId,
          result: {
            content: [{ type: "text", text: "response sent after cancellation" }],
          },
        }),
      )
      .then(
        () => {
          if (this.pending.get(requestId) !== pending) return;
          this.pending.delete(requestId);
          if (!pending.signal.aborted) this.completed.add(requestId);
          pending.reject(new Error("Late response sent after cancellation"));
        },
        (error: unknown) => {
          if (this.pending.get(requestId) !== pending) return;
          this.pending.delete(requestId);
          pending.reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
  }

  clear(): void {
    this.closed = true;
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.signal.removeEventListener("abort", pending.onAbort);
      pending.reject(new Error(`Late-response fault closed for request ${String(requestId)}`));
    }
    this.pending.clear();
    this.completed.clear();
  }

  consumeCompleted(requestId: RequestId): boolean {
    return this.completed.delete(requestId);
  }

  cancel(requestId: RequestId): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined || pending.sending) return;
    clearTimeout(pending.timer);
    pending.signal.removeEventListener("abort", pending.onAbort);
    this.pending.delete(requestId);
    pending.reject(new Error(`Late-response activation failed for request ${String(requestId)}`));
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

/** Handles stdio cancellation for every request ID, including zero. */
export class ResponseAfterCancellationTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport["onmessage"];

  constructor(
    private readonly delegate: Transport,
    private readonly faults: ResponseAfterCancellationFaults,
  ) {}

  async start(): Promise<void> {
    this.delegate.onclose = () => {
      this.faults.clear();
      this.onclose?.();
    };
    this.delegate.onerror = (error) => this.onerror?.(error);
    this.delegate.onmessage = (message, extra) => {
      this.onmessage?.(message, extra);
      if (isJSONRPCNotification(message) && message.method === "notifications/cancelled") {
        const requestId = message.params?.requestId;
        if (typeof requestId === "string" || typeof requestId === "number") {
          this.faults.observeCancellation(requestId);
        }
      }
    };
    await this.delegate.start();
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    if (
      isJSONRPCResponse(message) &&
      message.id !== undefined &&
      this.faults.consumeCompleted(message.id)
    ) {
      return Promise.resolve();
    }
    return this.delegate.send(message, options);
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

export function registerResponseAfterCancellationTool(
  server: McpServer,
  faults: ResponseAfterCancellationFaults,
): void {
  server.registerTool(
    "response_after_cancellation",
    {
      description: "Send a response after this call is cancelled (stdio only).",
      inputSchema: z.object({}),
    },
    async (_args, context) => {
      const requestId = context.mcpReq.id;
      const pending = faults.activate(requestId, context.mcpReq.signal);
      const progressToken = context.mcpReq._meta?.progressToken;
      if (progressToken !== undefined) {
        try {
          await context.mcpReq.notify({
            method: "notifications/progress",
            params: { progressToken, progress: 0, total: 1 },
          });
        } catch (error) {
          faults.cancel(requestId);
          await pending.catch(() => undefined);
          throw error;
        }
      }
      return pending;
    },
  );
}
