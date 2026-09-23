import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";

import { startHttpServer, type HttpServerHandle } from "../../src/httpServer.js";
import { CorrelationTrackingTransport } from "../helpers/concurrentMcpTestClient.js";

interface ConcurrentConnection {
  client: Client;
  transport: CorrelationTrackingTransport;
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

  await transport.gate.allArrived();
  const ids = expectConcurrentRequestIds(transport, requestOffset, "malformed_message");
  transport.gate.release();

  const [faultResult, healthyAResult, healthyBResult] = await Promise.allSettled([
    malformed,
    healthyA,
    healthyB,
  ]);
  expect(faultResult.status).toBe("rejected");
  expectHealthyPing(healthyAResult);
  expectHealthyPing(healthyBResult);

  await Promise.all(ids.healthy.map((id) => transport.waitForResponseCount(id, 1)));
  expect([0, 1]).toContain(transport.responseCount(ids.fault));
  expect(ids.healthy.map((id) => transport.responseCount(id))).toEqual([1, 1]);
}

async function verifyDuplicateIsolation(connection: ConcurrentConnection): Promise<void> {
  const { client, transport } = connection;
  const requestOffset = transport.requests.length;
  transport.gate.arm(3);

  const duplicate = client.callTool({ name: "duplicate_response", arguments: {} });
  const healthyA = client.callTool({ name: "ping", arguments: {} });
  const healthyB = client.callTool({ name: "ping", arguments: {} });

  await transport.gate.allArrived();
  const ids = expectConcurrentRequestIds(transport, requestOffset, "duplicate_response");
  transport.gate.release();

  const [duplicateResult, healthyAResult, healthyBResult] = await Promise.allSettled([
    duplicate,
    healthyA,
    healthyB,
  ]);
  expectHealthyToolResult(duplicateResult);
  expectHealthyPing(healthyAResult);
  expectHealthyPing(healthyBResult);

  await transport.waitForResponseCount(ids.fault, 2);
  await Promise.all(ids.healthy.map((id) => transport.waitForResponseCount(id, 1)));
  expect(transport.responseCount(ids.fault)).toBe(2);
  expect(ids.healthy.map((id) => transport.responseCount(id))).toEqual([1, 1]);
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
  }
}

async function connectStdio(): Promise<ConcurrentConnection> {
  return connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/cli.ts", "serve"],
      cwd: process.cwd(),
      stderr: "pipe",
    }),
    "2026-07-28",
  );
}

async function connectHttp(
  protocolVersion: "2025-11-25" | "2026-07-28",
): Promise<ConcurrentConnection> {
  const server = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
  try {
    return await connect(new StreamableHTTPClientTransport(server.url), protocolVersion, server);
  } catch (error) {
    await server.close();
    throw error;
  }
}

async function connect(
  delegate: StdioClientTransport | StreamableHTTPClientTransport,
  protocolVersion: "2025-11-25" | "2026-07-28",
  server?: HttpServerHandle,
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
    close: async () => {
      if (closed) return;
      closed = true;
      await client.close();
      await server?.close();
      transport.assertIdle();
    },
  };
}
