import { describe, expect, it } from "vitest";

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
});

function initializeRequest(id: number): Request {
  return new Request("http://mcp.test/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
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
