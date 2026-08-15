import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface McpTestClient {
  client: Client;
  close(): Promise<void>;
}

export async function connectTestClient(server: McpServer): Promise<McpTestClient> {
  const client = new Client({
    name: "mcp-failure-lab-test-client",
    version: "0.1.0",
  });
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
