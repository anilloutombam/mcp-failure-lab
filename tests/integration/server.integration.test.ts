import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { createServer } from "../../src/server.js";
import { connectTestClient, type TestProtocolVersion } from "../helpers/mcpTestClient.js";

const require = createRequire(import.meta.url);

const packageJson = require("../../package.json") as {
  version: string;
};

describe("MCP server metadata", () => {
  it("reports the package version during initialization", async () => {
    const server = createServer();
    const connection = await connectTestClient(server);

    try {
      expect(connection.client.getServerVersion()).toEqual({
        name: "mcp-failure-lab",
        version: packageJson.version,
      });
    } finally {
      await connection.close();
    }
  });

  it.each<TestProtocolVersion>(["2026-07-28", "2025-11-25"])(
    "negotiates protocol %s explicitly",
    async (protocolVersion) => {
      const connection = await connectTestClient(createServer(), protocolVersion);

      try {
        expect(connection.client.getNegotiatedProtocolVersion()).toBe(protocolVersion);
        expect(connection.client.getProtocolEra()).toBe(
          protocolVersion === "2026-07-28" ? "modern" : "legacy",
        );
      } finally {
        await connection.close();
      }
    },
  );
});
