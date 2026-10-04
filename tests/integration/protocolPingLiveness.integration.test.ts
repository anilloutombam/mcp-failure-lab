import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createServer } from "../../src/server.js";
import { connectTestClient } from "../helpers/mcpTestClient.js";

const resultSchema = z.object({
  status: z.enum(["protocol_ping_succeeded", "protocol_ping_failed"]),
  protocolPing: z.object({
    outcome: z.enum(["success", "unsupported", "invalid_response", "timeout"]),
  }),
  transport: z.object({ outcome: z.enum(["retained", "closed"]) }),
});

describe("protocol ping liveness MCP integration", () => {
  it("retains a shared connection and an unrelated active call when closure is requested", async () => {
    let started!: () => void;
    let release!: () => void;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    const diagnostics: unknown[] = [];
    const connection = await connectTestClient(
      () =>
        createServer({
          sleeper: {
            wait: async () => {
              started();
              await finish;
            },
          },
          protocolPingRecorder: (diagnostic) => diagnostics.push(diagnostic),
        }),
      "2025-11-25",
    );
    connection.client.setRequestHandler("ping", async () => {
      throw new Error("client rejected ping");
    });
    const unrelated = connection.client.callTool({ name: "delay", arguments: { delayMs: 1 } });
    try {
      await active;
      const result = await connection.client.callTool({
        name: "protocol_ping_liveness",
        arguments: {
          pingAfterMs: 0,
          livenessTimeoutMs: 100,
          closeOnFailure: true,
        },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: expect.stringContaining("closure_unavailable") },
      ]);
      expect(diagnostics).toEqual([
        expect.objectContaining({
          requestId: expect.any(Number),
          transport: { outcome: "closure_unavailable" },
        }),
      ]);
      release();
      await expect(unrelated).resolves.toMatchObject({ content: [{ type: "text" }] });
      await expect(
        connection.client.callTool({ name: "ping", arguments: {} }),
      ).resolves.toMatchObject({ content: [{ type: "text" }] });
    } finally {
      release();
      await unrelated.catch(() => undefined);
      await connection.close();
    }
  });
  it("sends a protocol ping while a legacy tool call is in flight", async () => {
    const connection = await connectTestClient(() => createServer(), "2025-11-25");
    let pingCount = 0;
    connection.client.setRequestHandler("ping", async () => {
      pingCount += 1;
      return {};
    });

    try {
      const rawResult = await connection.client.callTool({
        name: "protocol_ping_liveness",
        arguments: {
          pingAfterMs: 0,
          livenessTimeoutMs: 100,
          completionDelayMs: 0,
          closeOnFailure: false,
        },
      });
      expect(rawResult.isError).not.toBe(true);
      expect(pingCount).toBe(1);
      const content = rawResult.content[0];
      if (content?.type !== "text") throw new Error("expected text result");
      expect(resultSchema.parse(JSON.parse(content.text))).toEqual({
        status: "protocol_ping_succeeded",
        protocolPing: { outcome: "success" },
        transport: { outcome: "retained" },
      });
    } finally {
      await connection.close();
    }
  });

  it("reports protocol ping as unsupported on the modern protocol", async () => {
    const connection = await connectTestClient(() => createServer(), "2026-07-28");

    try {
      const rawResult = await connection.client.callTool({
        name: "protocol_ping_liveness",
        arguments: {
          pingAfterMs: 0,
          livenessTimeoutMs: 100,
          completionDelayMs: 0,
          closeOnFailure: false,
        },
      });
      expect(rawResult.isError).toBe(true);
      const content = rawResult.content[0];
      if (content?.type !== "text") throw new Error("expected text result");
      expect(resultSchema.parse(JSON.parse(content.text))).toMatchObject({
        status: "protocol_ping_failed",
        protocolPing: { outcome: "unsupported" },
        transport: { outcome: "retained" },
      });
    } finally {
      await connection.close();
    }
  });

  it("bounds an unanswered protocol ping and keeps the connection when configured", async () => {
    const connection = await connectTestClient(() => createServer(), "2025-11-25");
    connection.client.setRequestHandler("ping", async () => new Promise(() => undefined));

    try {
      const rawResult = await connection.client.callTool(
        {
          name: "protocol_ping_liveness",
          arguments: {
            pingAfterMs: 0,
            livenessTimeoutMs: 20,
            completionDelayMs: 0,
            closeOnFailure: false,
          },
        },
        { timeout: 500 },
      );
      expect(rawResult.isError).toBe(true);
      const content = rawResult.content[0];
      if (content?.type !== "text") throw new Error("expected text result");
      expect(resultSchema.parse(JSON.parse(content.text))).toMatchObject({
        status: "protocol_ping_failed",
        protocolPing: { outcome: "timeout" },
        transport: { outcome: "retained" },
      });
      await expect(
        connection.client.callTool({ name: "ping", arguments: {} }),
      ).resolves.toMatchObject({
        content: [{ type: "text" }],
      });
    } finally {
      await connection.close();
    }
  });
});
