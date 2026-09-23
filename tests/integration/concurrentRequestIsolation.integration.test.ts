import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";

import { startHttpServer, type HttpServerHandle } from "../../src/httpServer.js";
import { CorrelationTrackingTransport } from "../helpers/concurrentMcpTestClient.js";

interface ConcurrentConnection {
  client: Client;
  transport: CorrelationTrackingTransport;
  malformedEvidence: MalformedResponseEvidence;
  close(): Promise<void>;
}

const closeConnections: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeConnections.splice(0).map((close) => close()));
});

const transportCases = [
  { name: "stdio", connect: connectStdio },
  { name: "modern HTTP", connect: () => connectHttp("2026-07-28") },
  { name: "legacy HTTP", connect: () => connectHttp("2025-11-25") },
];

describe.each(transportCases)("concurrent request isolation over $name", ({ connect }) => {
  it("isolates a malformed response from healthy calls across repeated runs", async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await withConnection(connect, verifyMalformedIsolation);
    }
  });

  it("isolates a duplicate response from healthy calls across repeated runs", async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await withConnection(connect, verifyDuplicateIsolation);
    }
  });
});

async function withConnection(
  connect: () => Promise<ConcurrentConnection>,
  verify: (connection: ConcurrentConnection) => Promise<void>,
): Promise<void> {
  const connection = await connect();
  closeConnections.push(connection.close);
  try {
    await verify(connection);
    connection.transport.assertIdle();
  } finally {
    closeConnections.pop();
    await connection.close();
  }
}

async function verifyMalformedIsolation(connection: ConcurrentConnection): Promise<void> {
  const { client, transport } = connection;
  const requestOffset = transport.requests.length;
  transport.gate.arm(3);

  const malformed = client.callTool(
    {
      name: "malformed_message",
      arguments: { variant: "result-with-error" },
    },
    { timeout: 1_000 },
  );
  const healthyA = client.callTool({ name: "ping", arguments: {} });
  const healthyB = client.callTool({ name: "ping", arguments: {} });
  const calls = [malformed, healthyA, healthyB] as const;

  try {
    await transport.gate.allArrived();
    const ids = expectConcurrentRequestIds(transport, requestOffset, "malformed_message");
    transport.gate.release();

    const [faultResult, healthyAResult, healthyBResult] = await Promise.allSettled(calls);
    expect(faultResult.status).toBe("rejected");
    expectHealthyPing(healthyAResult);
    expectHealthyPing(healthyBResult);

    await Promise.all(ids.healthy.map((id) => transport.waitForResponseCount(id, 1)));
    await connection.malformedEvidence.waitFor(ids.fault);
    expect(ids.healthy.map((id) => transport.responseCount(id))).toEqual([1, 1]);
  } finally {
    transport.gate.close();
    await Promise.allSettled(calls);
  }
}

async function verifyDuplicateIsolation(connection: ConcurrentConnection): Promise<void> {
  const { client, transport } = connection;
  const requestOffset = transport.requests.length;
  transport.gate.arm(3);

  const duplicate = client.callTool({ name: "duplicate_response", arguments: {} });
  const healthyA = client.callTool({ name: "ping", arguments: {} });
  const healthyB = client.callTool({ name: "ping", arguments: {} });
  const calls = [duplicate, healthyA, healthyB] as const;

  try {
    await transport.gate.allArrived();
    const ids = expectConcurrentRequestIds(transport, requestOffset, "duplicate_response");
    transport.gate.release();

    const [duplicateResult, healthyAResult, healthyBResult] = await Promise.allSettled(calls);
    expectHealthyToolResult(duplicateResult);
    expectHealthyPing(healthyAResult);
    expectHealthyPing(healthyBResult);

    await transport.waitForResponseCount(ids.fault, 2);
    await Promise.all(ids.healthy.map((id) => transport.waitForResponseCount(id, 1)));
    expect(transport.responseCount(ids.fault)).toBe(2);
    expect(ids.healthy.map((id) => transport.responseCount(id))).toEqual([1, 1]);
  } finally {
    transport.gate.close();
    await Promise.allSettled(calls);
  }
}

function expectConcurrentRequestIds(
  transport: CorrelationTrackingTransport,
  offset: number,
  faultTool: string,
): { fault: string | number; healthy: Array<string | number>; all: Array<string | number> } {
  const ids = transport.requestIdsSince(offset);
  const fault = ids.get(faultTool) ?? [];
  const healthy = ids.get("ping") ?? [];
  const all = [...fault, ...healthy];

  expect(fault).toHaveLength(1);
  expect(healthy).toHaveLength(2);
  expect(new Set(all).size).toBe(3);
  return { fault: fault[0]!, healthy, all };
}

function expectHealthyPing(result: PromiseSettledResult<unknown>): void {
  expectHealthyToolResult(result);
  if (result.status !== "fulfilled") return;
  expect(result.value).toMatchObject({
    content: [{ type: "text", text: expect.stringContaining('"status":"ok"') }],
  });
}

function expectHealthyToolResult(result: PromiseSettledResult<unknown>): void {
  expect(result.status).toBe("fulfilled");
  if (result.status === "fulfilled") {
    expect(result.value).toMatchObject({ content: [{ type: "text" }] });
    expect(result.value).not.toMatchObject({ isError: true });
  }
}

async function connectStdio(): Promise<ConcurrentConnection> {
  const malformedEvidence = new MalformedResponseEvidence();
  const delegate = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "tests/fixtures/concurrentStdioServer.ts"],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  let stderr = "";
  const onStderr = (chunk: Buffer): void => {
    stderr += chunk.toString();
    const lines = stderr.split("\n");
    stderr = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const evidence = JSON.parse(line) as { malformedResponseId?: unknown };
        if (
          typeof evidence.malformedResponseId === "string" ||
          typeof evidence.malformedResponseId === "number"
        ) {
          malformedEvidence.record(evidence.malformedResponseId);
        }
      } catch {
        // Ignore unrelated diagnostic output from the child process.
      }
    }
  };
  delegate.stderr?.on("data", onStderr);
  return connect(delegate, "2026-07-28", undefined, malformedEvidence, () => {
    delegate.stderr?.off("data", onStderr);
  });
}

async function connectHttp(
  protocolVersion: "2025-11-25" | "2026-07-28",
): Promise<ConcurrentConnection> {
  const server = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
  const malformedEvidence = new MalformedResponseEvidence();
  const transport = new StreamableHTTPClientTransport(server.url, {
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      void recordMalformedHttpResponse(response.clone(), malformedEvidence).catch(() => {});
      return response;
    },
  });
  try {
    return await connect(transport, protocolVersion, server, malformedEvidence);
  } catch (error) {
    await server.close();
    throw error;
  }
}

async function connect(
  delegate: StdioClientTransport | StreamableHTTPClientTransport,
  protocolVersion: "2025-11-25" | "2026-07-28",
  server?: HttpServerHandle,
  malformedEvidence = new MalformedResponseEvidence(),
  afterClose?: () => void,
): Promise<ConcurrentConnection> {
  const client = new Client(
    { name: "concurrent-isolation-test", version: "0.1.0" },
    {
      supportedProtocolVersions: [protocolVersion],
      versionNegotiation:
        protocolVersion === "2025-11-25" ? { mode: "legacy" } : { mode: { pin: protocolVersion } },
    },
  );
  const transport = new CorrelationTrackingTransport(delegate);
  await client.connect(transport);

  let closed = false;
  return {
    client,
    transport,
    malformedEvidence,
    close: async () => {
      if (closed) return;
      closed = true;
      await client.close();
      await server?.close();
      afterClose?.();
      malformedEvidence.close();
      transport.assertIdle();
    },
  };
}

class MalformedResponseEvidence {
  private readonly ids = new Set<string | number>();
  private readonly waiters = new Set<{
    id: string | number;
    timer: ReturnType<typeof setTimeout>;
    resolve(): void;
    reject(error: Error): void;
  }>();

  record(id: string | number): void {
    this.ids.add(id);
    for (const waiter of this.waiters) {
      if (waiter.id !== id) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve();
    }
  }

  waitFor(id: string | number, timeoutMs = 1_000): Promise<void> {
    if (this.ids.has(id)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        id,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Timed out waiting for malformed response ${String(id)}`));
        }, timeoutMs),
        resolve,
        reject,
      };
      this.waiters.add(waiter);
    });
  }

  close(): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Malformed response evidence closed"));
    }
    this.waiters.clear();
  }
}

async function recordMalformedHttpResponse(
  response: Response,
  evidence: MalformedResponseEvidence,
): Promise<void> {
  const text = await response.text();
  const payloads = response.headers.get("content-type")?.includes("text/event-stream")
    ? text
        .split(/\r\n|\r|\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
    : [text];

  for (const payload of payloads) {
    try {
      const message = JSON.parse(payload) as Record<string, unknown>;
      if (
        "result" in message &&
        "error" in message &&
        (typeof message.id === "string" || typeof message.id === "number")
      ) {
        evidence.record(message.id);
      }
    } catch {
      // Non-JSON responses cannot be malformed JSON-RPC evidence.
    }
  }
}
