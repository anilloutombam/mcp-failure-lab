import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import { LegacyHttpSessions } from "../../src/legacyHttpSessions.js";

describe("legacy HTTP sessions", () => {
  it("bounds active sessions and releases them on close", async () => {
    const sessions = new LegacyHttpSessions(1);
    const first = await sessions.fetch(initializeRequest(1));
    await first.text();
    expect(first.status).toBe(200);
    expect(first.headers.get("mcp-session-id")).toBeTruthy();

    const overflow = await sessions.fetch(initializeRequest(2));
    expect(overflow.status).toBe(503);
    await expect(overflow.json()).resolves.toMatchObject({
      error: { message: "Too many active sessions" },
    });

    await sessions.close();
    await sessions.close();
    const afterClose = await sessions.fetch(initializeRequest(3));
    expect(afterClose.status).toBe(503);
  });

  it("reclaims an idle session before applying the session limit", async () => {
    let now = 0;
    const sessions = new LegacyHttpSessions(1, 1_000, () => now);
    const first = await sessions.fetch(initializeRequest(1));
    const firstSessionId = first.headers.get("mcp-session-id");
    await first.text();
    expect(firstSessionId).toBeTruthy();

    now = 1_000;
    const replacement = await sessions.fetch(initializeRequest(2));
    await replacement.text();
    expect(replacement.status).toBe(200);
    expect(replacement.headers.get("mcp-session-id")).toBeTruthy();

    const staleRequest = initializeRequest(3, firstSessionId!);
    const staleResponse = await sessions.fetch(staleRequest);
    expect(staleResponse.status).toBe(404);

    await sessions.close();
  });

  it("does not admit a session during shutdown", async () => {
    const sessions = new LegacyHttpSessions();
    const initializing = sessions.fetch(initializeRequest(1));
    const closing = sessions.close();

    const response = await initializing;
    await closing;

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "Server shutting down" },
    });
  });

  it("closes a session when shutdown starts during connection", async () => {
    let markConnecting!: () => void;
    const connecting = new Promise<void>((resolve) => {
      markConnecting = resolve;
    });
    let finishConnecting!: () => void;
    const connectionGate = new Promise<void>((resolve) => {
      finishConnecting = resolve;
    });
    const start = vi
      .spyOn(WebStandardStreamableHTTPServerTransport.prototype, "start")
      .mockImplementationOnce(async () => {
        markConnecting();
        await connectionGate;
      });

    try {
      const sessions = new LegacyHttpSessions();
      const initializing = sessions.fetch(initializeRequest(1));
      await connecting;

      let firstFinished = false;
      let secondFinished = false;
      const firstClose = sessions.close().then(() => {
        firstFinished = true;
      });
      const secondClose = sessions.close().then(() => {
        secondFinished = true;
      });
      await Promise.resolve();
      expect(firstFinished).toBe(false);
      expect(secondFinished).toBe(false);

      finishConnecting();
      const response = await initializing;
      await Promise.all([firstClose, secondClose]);

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: { message: "Server shutting down" },
      });
    } finally {
      start.mockRestore();
    }
  });

  it("releases request tracking when a response body is cancelled", async () => {
    let now = 0;
    const sessions = new LegacyHttpSessions(1, 1_000, () => now);
    const response = await sessions.fetch(initializeRequest(1));
    expect(response.body).not.toBeNull();
    await response.body!.cancel();

    now = 1_000;
    const replacement = await sessions.fetch(initializeRequest(2));
    expect(replacement.status).toBe(200);
    await replacement.body!.cancel();
    await sessions.close();
  });

  it("closes a request that does not initialize a session", async () => {
    const sessions = new LegacyHttpSessions();
    const response = await sessions.fetch(toolCallRequest(1, undefined, "ping"));
    expect(response.status).toBe(400);
    await response.text();
    await sessions.close();
  });

  it("closes a lost session when its activation response is cancelled", async () => {
    const sessions = new LegacyHttpSessions();
    const initialized = await sessions.fetch(initializeRequest(1));
    const sessionId = initialized.headers.get("mcp-session-id");
    await initialized.text();
    expect(sessionId).toBeTruthy();

    const response = await sessions.fetch(
      toolCallRequest(2, sessionId!, "session_loss", { activation: "after_response" }),
    );
    await response.body!.cancel();

    const stale = await sessions.fetch(toolCallRequest(3, sessionId!, "ping"));
    expect(stale.status).toBe(404);
    await sessions.close();
  });

  it("closes a session when its response stream fails", async () => {
    const sessions = new LegacyHttpSessions();
    const initialized = await sessions.fetch(initializeRequest(1));
    const sessionId = initialized.headers.get("mcp-session-id");
    await initialized.text();
    expect(sessionId).toBeTruthy();

    const response = await sessions.fetch(toolCallRequest(2, sessionId!, "ping"));
    const read = vi
      .spyOn(ReadableStreamDefaultReader.prototype, "read")
      .mockRejectedValueOnce(new Error("response failed"));
    try {
      await expect(response.text()).rejects.toThrow("response failed");
    } finally {
      read.mockRestore();
      await sessions.close();
    }
  });

  it("handles disconnect without a Node response hook", async () => {
    const sessions = new LegacyHttpSessions();
    const initialized = await sessions.fetch(initializeRequest(1));
    const sessionId = initialized.headers.get("mcp-session-id");
    await initialized.text();
    expect(sessionId).toBeTruthy();

    const response = await sessions.fetch(toolCallRequest(2, sessionId!, "disconnect"));
    expect(response.status).toBe(200);
    await response.text();
    await sessions.close();
  });

  it("cleans up when the transport cannot connect", async () => {
    const start = vi
      .spyOn(WebStandardStreamableHTTPServerTransport.prototype, "start")
      .mockRejectedValueOnce(new Error("connect failed"));
    const sessions = new LegacyHttpSessions();
    await expect(sessions.fetch(initializeRequest(1))).rejects.toThrow("connect failed");
    start.mockRestore();
    await sessions.close();
  });

  it("releases request tracking when the transport handler fails", async () => {
    const sessions = new LegacyHttpSessions();
    const initialized = await sessions.fetch(initializeRequest(1));
    const sessionId = initialized.headers.get("mcp-session-id");
    await initialized.text();
    expect(sessionId).toBeTruthy();

    const handleRequest = vi
      .spyOn(WebStandardStreamableHTTPServerTransport.prototype, "handleRequest")
      .mockRejectedValueOnce(new Error("request failed"));
    await expect(sessions.fetch(toolCallRequest(2, sessionId!, "ping"))).rejects.toThrow(
      "request failed",
    );
    handleRequest.mockRestore();
    await sessions.close();
  });
});

function initializeRequest(id: number, sessionId?: string): Request {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  if (sessionId !== undefined) headers["mcp-session-id"] = sessionId;
  return new Request("http://mcp.test/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "session-test", version: "0.1.0" },
      },
    }),
  });
}

function toolCallRequest(
  id: number,
  sessionId: string | undefined,
  name: string,
  arguments_: Record<string, unknown> = {},
): Request {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2025-11-25",
  };
  if (sessionId !== undefined) headers["mcp-session-id"] = sessionId;
  return new Request("http://mcp.test/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: arguments_ },
    }),
  });
}
