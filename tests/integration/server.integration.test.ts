import { describe, expect, it } from "vitest";

import { createServer } from "../../src/server.js";
import { VERSION } from "../../src/version.js";
import { connectTestClient } from "../helpers/mcpTestClient.js";

describe("MCP server metadata", () => {
  it("reports the package version during initialization", async () => {
    const server = createServer();
    const connection = await connectTestClient(server);

    try {
      expect(connection.client.getServerVersion()).toEqual({
        name: "mcp-failure-lab",
        version: VERSION,
      });
    } finally {
      await connection.close();
    }
  });
});
