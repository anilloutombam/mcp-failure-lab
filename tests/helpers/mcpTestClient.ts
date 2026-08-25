import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

export type TestProtocolVersion = "2025-11-25" | "2026-07-28";

export interface McpTestClient {
  client: Client;
  close(): Promise<void>;
}

export async function connectTestClient(
  server: McpServer,
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
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const serverHandle =
    protocolVersion === "2026-07-28"
      ? serveStdio(() => server, { transport: serverTransport })
      : undefined;
  if (serverHandle === undefined) {
    await server.connect(serverTransport);
  }
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      if (serverHandle === undefined) {
        await server.close();
      } else {
        await serverHandle.close();
      }
    },
  };
}
