import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  MalformedMessageTransport,
  RequestScopedMalformedMessageFaults,
  type MalformedMessageVariant,
} from "../../src/malformedMessage.js";
import { createServer } from "../../src/server.js";

describe("malformed-message MCP integration", () => {
  const closeConnections: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closeConnections.splice(0).map((close) => close()));
  });

  it.each<MalformedMessageVariant>([
    "missing-jsonrpc",
    "invalid-jsonrpc-version",
    "result-with-error",
  ])("makes the client reject a %s response", async (variant) => {
    const { client } = await connectMalformedMessageClient(closeConnections);

    await expect(
      client.callTool({ name: "malformed_message", arguments: { variant } }, { timeout: 500 }),
    ).rejects.toThrow();
  });

  it("clears the fault after one response and supports repeated activation", async () => {
    const { client } = await connectMalformedMessageClient(closeConnections);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        client.callTool(
          {
            name: "malformed_message",
            arguments: { variant: "invalid-jsonrpc-version" },
          },
          { timeout: 500 },
        ),
      ).rejects.toThrow();

      await expect(client.callTool({ name: "ping", arguments: {} })).resolves.toMatchObject({
        content: [{ type: "text" }],
      });
    }
  });
});

async function connectMalformedMessageClient(
  closeConnections: Array<() => Promise<void>>,
): Promise<{ client: Client }> {
  const faults = new RequestScopedMalformedMessageFaults();
  const server = createServer({ malformedMessageFaults: faults });
  const client = new Client({ name: "malformed-message-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(new MalformedMessageTransport(serverTransport, faults));
  await client.connect(clientTransport);
  closeConnections.push(async () => {
    await client.close();
    await server.close();
  });

  return { client };
}
