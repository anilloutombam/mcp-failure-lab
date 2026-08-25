import { describe, expect, it } from "vitest";

import { createServer } from "../../src/server.js";
import { connectTestClient } from "../helpers/mcpTestClient.js";

describe("disconnect MCP integration", () => {
  it("closes the transport before returning a tool response", async () => {
    const connection = await connectTestClient(() => createServer());

    try {
      await expect(
        connection.client.callTool({ name: "disconnect", arguments: {} }),
      ).rejects.toThrow();
    } finally {
      await connection.close();
    }
  });
});
