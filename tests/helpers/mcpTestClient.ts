import { createMcpHandler, InMemoryTransport } from "@modelcontextprotocol/server";
import type { McpRequestContext, McpServer } from "@modelcontextprotocol/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export type TestProtocolVersion = "2025-11-25" | "2026-07-28";
export type McpTestServerFactory = (context: McpRequestContext) => McpServer;

export interface McpTestClient {
  client: Client;
  close(): Promise<void>;
}

export async function connectTestClient(
  createServer: McpTestServerFactory,
  protocolVersion: TestProtocolVersion = "2026-07-28",
): Promise<McpTestClient> {
  const client = new Client(
    {
      name: "mcp-failure-lab-test-client",
      version: "0.1.0",
    },
    {
      supportedProtocolVersions: [protocolVersion],
      versionNegotiation:
        protocolVersion === "2026-07-28" ? { mode: { pin: protocolVersion } } : { mode: "legacy" },
    },
  );
  if (protocolVersion === "2025-11-25") {
    const server = createServer({ era: "legacy" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    return {
      client,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  const handler = createMcpHandler(createServer, { legacy: "reject" });
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp-test.local"), {
    fetch: (input, init) => handler.fetch(new Request(input, init)),
  });
  await client.connect(transport);

  return {
    client,
    close: async () => {
      await client.close();
      await handler.close();
    },
  };
}
