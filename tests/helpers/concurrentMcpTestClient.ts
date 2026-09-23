import {
  isJSONRPCRequest,
  type JSONRPCMessage,
  type RequestId,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/client";

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Holds a known number of tool calls until the test explicitly releases them. */
export class ConcurrentRequestGate {
  private expected = 0;
  private blocked = 0;
  private closed = false;
  private arrival = deferred();
  private releaseSignal = deferred();

  arm(expected: number): void {
    if (this.closed || expected < 1 || this.expected !== 0 || this.blocked !== 0) {
      throw new Error("Concurrent request gate is already active or has an invalid size");
    }
    this.expected = expected;
    this.arrival = deferred();
    this.releaseSignal = deferred();
  }

  async block(): Promise<void> {
    if (this.closed) throw new Error("Concurrent request gate is closed");
    if (this.expected === 0) return;
    this.blocked += 1;
    if (this.blocked > this.expected) {
      throw new Error("More tool calls reached the gate than expected");
    }
    if (this.blocked === this.expected) this.arrival.resolve();
    await this.releaseSignal.promise;
  }

  allArrived(): Promise<void> {
    return this.arrival.promise;
  }

  release(): void {
    if (this.expected === 0 || this.blocked !== this.expected) {
      throw new Error("Cannot release the gate before every tool call arrives");
    }
    this.expected = 0;
    this.blocked = 0;
    this.releaseSignal.resolve();
  }

  close(): void {
    this.closed = true;
    this.expected = 0;
    const hadBlockedCalls = this.blocked !== 0;
    this.blocked = 0;
    if (hadBlockedCalls) {
      this.releaseSignal.reject(new Error("Concurrent request gate closed with blocked calls"));
    } else {
      this.releaseSignal.resolve();
    }
    this.arrival.resolve();
  }

  assertIdle(): void {
    if (this.expected !== 0 || this.blocked !== 0) {
      throw new Error("Concurrent request gate still has blocked calls");
    }
  }
}

/** Records request/response IDs while applying an explicit client-side send barrier. */
export class CorrelationTrackingTransport implements Transport {
  declare readonly hasPerRequestStream?: boolean;
  readonly requests: Array<{ id: RequestId; tool: string }> = [];
  readonly responses: JSONRPCMessage[] = [];
  readonly gate = new ConcurrentRequestGate();
  private readonly responseWaiters = new Set<ResponseWaiter>();

  constructor(private readonly delegate: Transport) {
    if (delegate.hasPerRequestStream !== undefined) {
      Object.defineProperty(this, "hasPerRequestStream", {
        value: delegate.hasPerRequestStream,
        enumerable: true,
      });
    }
  }

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport["onmessage"];

  async start(): Promise<void> {
    this.delegate.onclose = () => this.onclose?.();
    this.delegate.onerror = (error) => this.onerror?.(error);
    this.delegate.onmessage = (message, extra) => {
      if (responseId(message) !== undefined) {
        this.responses.push(message);
        for (const waiter of this.responseWaiters) waiter.notify();
      }
      this.onmessage?.(message, extra);
    };
    await this.delegate.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    if (isJSONRPCRequest(message) && message.method === "tools/call") {
      const params = message.params as { name?: unknown } | undefined;
      this.requests.push({
        id: message.id,
        tool: typeof params?.name === "string" ? params.name : "<unknown>",
      });
      await this.gate.block();
    }
    await this.delegate.send(message, options);
  }

  async close(): Promise<void> {
    this.gate.close();
    for (const waiter of this.responseWaiters) waiter.reject(new Error("Transport closed"));
    this.responseWaiters.clear();
    await this.delegate.close();
  }

  setProtocolVersion(version: string): void {
    this.delegate.setProtocolVersion?.(version);
  }

  setSupportedProtocolVersions(versions: string[]): void {
    this.delegate.setSupportedProtocolVersions?.(versions);
  }

  requestIdsSince(offset: number): Map<string, RequestId[]> {
    const byTool = new Map<string, RequestId[]>();
    for (const request of this.requests.slice(offset)) {
      const ids = byTool.get(request.tool) ?? [];
      ids.push(request.id);
      byTool.set(request.tool, ids);
    }
    return byTool;
  }

  responseCount(id: RequestId): number {
    return this.responses.filter((message) => responseId(message) === id).length;
  }

  waitForResponseCount(id: RequestId, count: number, timeoutMs = 1_000): Promise<void> {
    if (this.responseCount(id) >= count) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const finish = (settle: () => void): void => {
        clearTimeout(waiter.timer);
        this.responseWaiters.delete(waiter);
        settle();
      };
      const waiter: ResponseWaiter = {
        timer: setTimeout(() => {
          finish(() => reject(new Error(`Timed out waiting for response ${String(id)}`)));
        }, timeoutMs),
        notify: () => {
          if (this.responseCount(id) < count) return;
          finish(resolve);
        },
        reject: (error) => finish(() => reject(error)),
      };
      this.responseWaiters.add(waiter);
    });
  }

  assertIdle(): void {
    this.gate.assertIdle();
    if (this.responseWaiters.size !== 0) {
      throw new Error("Correlation tracker still has response listeners");
    }
  }
}

interface ResponseWaiter {
  timer: ReturnType<typeof setTimeout>;
  notify(): void;
  reject(error: Error): void;
}

function responseId(message: JSONRPCMessage): RequestId | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  if (!("result" in message) && !("error" in message)) return undefined;
  const { id } = message as { id?: unknown };
  return typeof id === "string" || typeof id === "number" ? id : undefined;
}
