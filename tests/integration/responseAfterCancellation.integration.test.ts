import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";

import { startHttpServer } from "../../src/httpServer.js";
import { CorrelationTrackingTransport } from "../helpers/concurrentMcpTestClient.js";

describe.each(["2026-07-28", "2025-11-25"] as const)(
  "response after cancellation over stdio (%s)",
  (version) => {
    it("sends one late response for the cancelled ID without settling a healthy call", async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const client = new Client(
          { name: "late-response-test", version: "0.1.0" },
          {
            supportedProtocolVersions: [version],
            versionNegotiation:
              version === "2025-11-25" ? { mode: "legacy" } : { mode: { pin: version } },
          },
        );
        const transport = new CorrelationTrackingTransport(
          new StdioClientTransport({
            command: process.execPath,
            args: ["--import", "tsx", "src/cli.ts", "serve"],
            cwd: process.cwd(),
            stderr: "pipe",
          }),
        );
        const errors: Error[] = [];
        client.onerror = (error) => errors.push(error);
        await client.connect(transport);

        const controller = new AbortController();
        let cancelled: Promise<unknown> | undefined;
        let healthy: Promise<unknown> | undefined;
        let activationTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          let activated!: () => void;
          const activation = new Promise<void>((resolve, reject) => {
            activated = resolve;
            activationTimer = setTimeout(
              () => reject(new Error("Late-response activation was not observed")),
              2_000,
            );
          });
          cancelled = client.callTool(
            { name: "response_after_cancellation", arguments: {} },
            {
              signal: controller.signal,
              timeout: 2_000,
              onprogress: () => {
                clearTimeout(activationTimer);
                activated();
              },
            },
          );
          void cancelled.catch(() => undefined);
          await activation;
          const faultId = transport.requests.at(-1)?.id;
          expect(transport.requests.at(-1)?.tool).toBe("response_after_cancellation");
          expect(faultId).toBeDefined();

          transport.gate.arm(1);
          let healthySettled = false;
          healthy = client
            .callTool({ name: "ping", arguments: {} }, { timeout: 2_000 })
            .finally(() => {
              healthySettled = true;
            });
          void healthy.catch(() => undefined);
          await transport.gate.allArrived();
          const healthyId = transport.requests.at(-1)?.id;
          expect(healthyId).not.toBe(faultId);

          controller.abort();
          await expect(cancelled).rejects.toThrow();
          await transport.waitForResponseCount(faultId!, 1);
          expect(healthySettled).toBe(false);
          expect(transport.responseCount(faultId!)).toBe(1);
          expect(transport.responseCount(healthyId!)).toBe(0);

          transport.gate.release();
          await expect(healthy).resolves.toMatchObject({
            content: [{ type: "text", text: expect.stringContaining('"status":"ok"') }],
          });
          await transport.waitForResponseCount(healthyId!, 1);
          expect(transport.responseCount(faultId!)).toBe(1);
          expect(errors.some((error) => error.message.includes("unknown message ID"))).toBe(true);
          expect(
            errors.some((error) => error.message.includes("missing required resultType")),
          ).toBe(false);
          transport.assertIdle();
        } finally {
          clearTimeout(activationTimer);
          controller.abort();
          transport.gate.close();
          await Promise.allSettled([cancelled, healthy]);
          await client.close();
          transport.assertIdle();
        }
      }
    });
  },
);

it.each(["2026-07-28", "2025-11-25"] as const)(
  "does not advertise the late-response fault over HTTP (%s)",
  async (version) => {
    const server = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
    const client = new Client(
      { name: "late-response-http-test", version: "0.1.0" },
      {
        supportedProtocolVersions: [version],
        versionNegotiation:
          version === "2025-11-25" ? { mode: "legacy" } : { mode: { pin: version } },
      },
    );
    try {
      await client.connect(new StreamableHTTPClientTransport(server.url));
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).not.toContain("response_after_cancellation");
    } finally {
      await client.close();
      await server.close();
    }
  },
);
