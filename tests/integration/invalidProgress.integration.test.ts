import { describe, expect, it, vi } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { executeScenario } from "../../src/scenarioCommand.js";
import {
  InvalidProgressTransport,
  MAX_PENDING_PROGRESS_FAULTS,
  RequestScopedInvalidProgressFaults,
} from "../../src/invalidProgress.js";
import { createServer } from "../../src/server.js";
import { startHttpServer } from "../../src/httpServer.js";
import { applyMalformedMessageResponse } from "../../src/malformedMessageHttp.js";
import { RequestScopedMalformedMessageFaults } from "../../src/malformedMessage.js";

describe("invalid progress notifications", () => {
  it("bounds pending late notifications and clears them", () => {
    const faults = new RequestScopedInvalidProgressFaults();
    for (let requestId = 0; requestId < MAX_PENDING_PROGRESS_FAULTS; requestId += 1) {
      faults.activateAfterCompletion(requestId, requestId);
    }
    expect(() => faults.activateAfterCompletion(MAX_PENDING_PROGRESS_FAULTS, 0)).toThrow(
      "Too many pending progress faults",
    );
    faults.clear();
    faults.activateAfterCompletion(MAX_PENDING_PROGRESS_FAULTS, 0);
    expect(
      faults.takeAfterCompletion({ jsonrpc: "2.0", id: MAX_PENDING_PROGRESS_FAULTS, result: {} }),
    ).toMatchObject({ method: "notifications/progress" });
  });

  it("removes a pending late notification when its request is cancelled", () => {
    const faults = new RequestScopedInvalidProgressFaults();
    const controller = new AbortController();
    faults.activateAfterCompletion(7, "token-7", controller.signal);
    controller.abort();
    expect(faults.takeAfterCompletion({ jsonrpc: "2.0", id: 7, result: {} })).toBeUndefined();
    faults.activateAfterCompletion(7, "replacement-token");
    expect(faults.takeAfterCompletion({ jsonrpc: "2.0", id: 7, result: {} })).toMatchObject({
      params: { progressToken: "replacement-token" },
    });
  });

  it("rejects duplicate or already cancelled late activations", () => {
    const faults = new RequestScopedInvalidProgressFaults();
    faults.activateAfterCompletion(7, "token-7");
    expect(() => faults.activateAfterCompletion(7, "replacement-token")).toThrow(
      "A progress fault is already pending for request 7",
    );
    const controller = new AbortController();
    controller.abort();
    expect(() => faults.activateAfterCompletion(8, "token-8", controller.signal)).toThrow(
      "Request was cancelled before progress fault activation",
    );
  });

  it("requires a client progress token", async () => {
    const faults = new RequestScopedInvalidProgressFaults();
    const server = createServer({ invalidProgressFaults: faults });
    const client = new Client(
      { name: "progress-token-test", version: "1" },
      { supportedProtocolVersions: ["2025-11-25"], versionNegotiation: { mode: "legacy" } },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(new InvalidProgressTransport(serverTransport, faults));
      await client.connect(clientTransport);
      await expect(
        client.callTool({ name: "invalid_progress", arguments: { variant: "unknown-token" } }),
      ).resolves.toMatchObject({ isError: true });
      await expect(client.callTool({ name: "ping", arguments: {} })).resolves.toMatchObject({
        content: [{ type: "text" }],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each(["2025-11-25", "2026-07-28"] as const)(
    "serves ordered progress faults over the CLI stdio transport on %s",
    async (protocolVersion) => {
      const client = new Client(
        { name: "progress-stdio-test", version: "1" },
        {
          supportedProtocolVersions: [protocolVersion],
          versionNegotiation:
            protocolVersion === "2025-11-25"
              ? { mode: "legacy" }
              : { mode: { pin: protocolVersion } },
        },
      );
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", "src/cli.ts", "serve"],
        cwd: process.cwd(),
        stderr: "pipe",
      });
      try {
        await client.connect(transport);
        const rawProgress: unknown[] = [];
        const rawOrder: string[] = [];
        const onmessage = transport.onmessage;
        transport.onmessage = (message) => {
          if ("method" in message && message.method === "notifications/progress") {
            rawProgress.push(message);
            rawOrder.push(`progress:${String(message.params?.progress)}`);
          } else if ("id" in message) {
            rawOrder.push("response");
          }
          return onmessage?.(message);
        };
        await expect(
          client.callTool(
            { name: "invalid_progress", arguments: { variant: "regressing-progress" } },
            { timeout: 2_000, onprogress: () => undefined },
          ),
        ).resolves.toMatchObject({ content: [{ type: "text" }] });
        expect(rawProgress).toHaveLength(2);
        expect(rawOrder).toEqual(["progress:2", "progress:1", "response"]);
        const tokens = rawProgress.map(
          (message) => (message as { params: { progressToken: unknown } }).params.progressToken,
        );
        expect(tokens[0]).toBe(tokens[1]);
        await expect(client.callTool({ name: "ping", arguments: {} })).resolves.toMatchObject({
          content: [{ type: "text" }],
        });
      } finally {
        await client.close();
      }
    },
  );

  it("sends the unknown-token fault and then the late fault in request order", async () => {
    const faults = new RequestScopedInvalidProgressFaults();
    const server = createServer({ invalidProgressFaults: faults });
    const client = new Client(
      { name: "progress-wire-test", version: "1" },
      { supportedProtocolVersions: ["2025-11-25"], versionNegotiation: { mode: "legacy" } },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const outbound: Array<{
      method?: string | undefined;
      id?: string | number | undefined;
      params?: unknown;
    }> = [];
    const originalSend = serverTransport.send.bind(serverTransport);
    serverTransport.send = async (message, options) => {
      outbound.push(message);
      await originalSend(message, options);
    };
    try {
      await server.connect(new InvalidProgressTransport(serverTransport, faults));
      await client.connect(clientTransport);
      const received: number[] = [];

      let start = outbound.length;
      await client.callTool(
        { name: "invalid_progress", arguments: { variant: "unknown-token" } },
        { onprogress: (progress) => void received.push(progress.progress) },
      );
      expect(
        outbound.slice(start).filter((message) => message.method === "notifications/progress"),
      ).toMatchObject([{ params: { progressToken: "mcp-failure-lab-unknown", progress: 1 } }]);
      expect(received).toEqual([]);

      start = outbound.length;
      await client.callTool(
        { name: "invalid_progress", arguments: { variant: "after-completion" } },
        { onprogress: (progress) => void received.push(progress.progress) },
      );
      await vi.waitFor(() => {
        expect(
          outbound.slice(start).filter((message) => message.method === "notifications/progress"),
        ).toHaveLength(1);
      });
      const messages = outbound.slice(start);
      const responseIndex = messages.findIndex((message) => message.id !== undefined);
      const lateIndex = messages.findIndex(
        (message) => message.method === "notifications/progress",
      );
      expect(responseIndex).toBeGreaterThanOrEqual(0);
      expect(lateIndex).toBeGreaterThan(responseIndex);
      expect(received).toEqual([]);
      await expect(client.callTool({ name: "ping", arguments: {} })).resolves.toMatchObject({
        content: [{ type: "text" }],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("places a late notification after the matching stdio response exactly once", async () => {
    const messages: unknown[] = [];
    const faults = new RequestScopedInvalidProgressFaults();
    const transport = new InvalidProgressTransport(
      {
        start: async () => undefined,
        send: async (message) => void messages.push(message),
        close: async () => undefined,
      },
      faults,
    );
    faults.activateAfterCompletion(7, "token-7");
    const response = { jsonrpc: "2.0" as const, id: 7, result: { content: [] } };
    await transport.send(response);
    await transport.send(response);
    expect(messages).toEqual([
      response,
      {
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { progressToken: "token-7", progress: 1, total: 3 },
      },
      response,
    ]);
    await transport.close();
  });

  it("places a late notification after the matching HTTP response event", async () => {
    const faults = new RequestScopedInvalidProgressFaults();
    faults.activateAfterCompletion(9, "token-9");
    const response = await applyMalformedMessageResponse(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 9, result: { content: [] } }), {
        headers: { "content-type": "application/json" },
      }),
      new RequestScopedMalformedMessageFaults(),
      undefined,
      faults,
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = (await response.text()).trim().split("\n\n");
    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0]!.slice("event: message\ndata: ".length))).toMatchObject({ id: 9 });
    expect(JSON.parse(events[1]!.slice("event: message\ndata: ".length))).toMatchObject({
      method: "notifications/progress",
      params: { progressToken: "token-9" },
    });
  });

  it("places a late notification after the matching legacy SSE response event", async () => {
    const faults = new RequestScopedInvalidProgressFaults();
    faults.activateAfterCompletion(9, "token-9");
    const response = await applyMalformedMessageResponse(
      new Response('event: message\ndata: {"jsonrpc":"2.0","id":9,"result":{}}\n\n', {
        headers: { "content-type": "text/event-stream" },
      }),
      new RequestScopedMalformedMessageFaults(),
      undefined,
      faults,
    );
    const events = (await response.text()).trim().split("\n\n");
    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0]!.slice("event: message\ndata: ".length))).toMatchObject({ id: 9 });
    expect(JSON.parse(events[1]!.slice("event: message\ndata: ".length))).toMatchObject({
      method: "notifications/progress",
      params: { progressToken: "token-9" },
    });
  });

  it.each(["2025-11-25", "2026-07-28"] as const)(
    "records regressing values and recovers on %s",
    async (protocolVersion) => {
      const result = await executeScenario({
        name: "regressing progress",
        protocolVersion,
        call: { tool: "invalid_progress", args: { variant: "regressing-progress" } },
        expect: { outcome: "success", progressValues: [2, 1] },
        observe: { call: { tool: "ping", args: {} }, expect: { outcome: "success" } },
      });
      expect(result).toMatchObject({ passed: true, progressValues: [2, 1] });
    },
  );

  it("fails when observed progress values differ from the assertion", async () => {
    const result = await executeScenario({
      name: "progress mismatch",
      call: { tool: "invalid_progress", args: { variant: "regressing-progress" } },
      expect: { outcome: "success", progressValues: [1, 2] },
    });
    expect(result).toMatchObject({
      passed: false,
      progressValues: [2, 1],
      failures: ["expected progress values [1,2], received [2,1]"],
    });
  });

  it.each(["2025-11-25", "2026-07-28"] as const)(
    "ignores an unknown token and a notification after completion on %s",
    async (protocolVersion) => {
      for (const variant of ["unknown-token", "after-completion"]) {
        const result = await executeScenario({
          name: variant,
          protocolVersion,
          call: { tool: "invalid_progress", args: { variant } },
          expect: { outcome: "success", progressValues: [] },
          observe: { call: { tool: "ping", args: {} }, expect: { outcome: "success" } },
        });
        expect(result.passed).toBe(true);
      }
    },
  );

  it("exposes progress faults on the public HTTP endpoint", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
    const client = new Client(
      { name: "progress-http-test", version: "1" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    try {
      await client.connect(new StreamableHTTPClientTransport(handle.url));
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("invalid_progress");
      const values: number[] = [];
      await client.callTool(
        { name: "invalid_progress", arguments: { variant: "regressing-progress" } },
        { onprogress: (progress) => void values.push(progress.progress) },
      );
      expect(values).toEqual([2, 1]);
    } finally {
      await client.close();
      await handle.close();
    }
  });

  it("exposes progress faults on initialized legacy HTTP sessions", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, path: "/mcp" });
    const client = new Client(
      { name: "progress-legacy-http-test", version: "1" },
      { supportedProtocolVersions: ["2025-11-25"], versionNegotiation: { mode: "legacy" } },
    );
    try {
      await client.connect(new StreamableHTTPClientTransport(handle.url));
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("invalid_progress");
      const values: number[] = [];
      await client.callTool(
        { name: "invalid_progress", arguments: { variant: "regressing-progress" } },
        { onprogress: (progress) => void values.push(progress.progress) },
      );
      expect(values).toEqual([2, 1]);
      await client.callTool(
        { name: "invalid_progress", arguments: { variant: "after-completion" } },
        { onprogress: (progress) => void values.push(progress.progress) },
      );
      expect(values).toEqual([2, 1]);
      await expect(client.callTool({ name: "ping", arguments: {} })).resolves.toMatchObject({
        content: [{ type: "text" }],
      });
    } finally {
      await client.close();
      await handle.close();
    }
  });
});
