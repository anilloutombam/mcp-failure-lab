import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SdkErrorCode } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { startHttpServer } from "../../src/httpServer.js";

function createClient(): Client {
  return new Client(
    { name: "http-disconnect-e2e-test", version: "0.1.0" },
    {
      supportedProtocolVersions: ["2025-11-25"],
      versionNegotiation: { mode: "legacy" },
    },
  );
}

describe("Streamable HTTP disconnect", () => {
  it("fails the active request without stopping the HTTP server", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
    const disconnectingClient = createClient();
    const replacementClient = createClient();

    try {
      await disconnectingClient.connect(new StreamableHTTPClientTransport(handle.url));

      const disconnectResult = await disconnectingClient
        .callTool({ name: "disconnect", arguments: {} }, { timeout: 1_000 })
        .then(
          (result) => ({ status: "resolved" as const, result }),
          (error: unknown) => ({ status: "rejected" as const, error }),
        );

      expect(disconnectResult.status).toBe("rejected");
      if (disconnectResult.status === "rejected") {
        expect(disconnectResult.error).not.toMatchObject({ code: SdkErrorCode.RequestTimeout });
      }

      await replacementClient.connect(new StreamableHTTPClientTransport(handle.url));
      const pingResult = await replacementClient.callTool({ name: "ping", arguments: {} });

      expect(pingResult.isError).not.toBe(true);
    } finally {
      await disconnectingClient.close();
      await replacementClient.close();
      await handle.close();
    }
  });
});
