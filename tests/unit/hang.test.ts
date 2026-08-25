import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";

import { registerHangTool, waitForCancellation } from "../../src/hang.js";

describe("waitForCancellation", () => {
  it("remains pending until cancellation", async () => {
    const controller = new AbortController();
    const settled = vi.fn();
    const pending = waitForCancellation(controller.signal).finally(settled);

    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(settled).toHaveBeenCalledOnce();
  });

  it("rejects immediately when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled by test"));

    await expect(waitForCancellation(controller.signal)).rejects.toThrow("cancelled by test");
  });

  it("passes the request cancellation signal to the hang handler", async () => {
    let handler:
      | ((
          args: Record<string, never>,
          context: { mcpReq: { signal: AbortSignal } },
        ) => Promise<unknown>)
      | undefined;
    const server = {
      registerTool: vi.fn((_name, _config, callback) => {
        handler = callback;
      }),
    } as unknown as McpServer;
    const controller = new AbortController();
    controller.abort(new Error("request cancelled"));

    registerHangTool(server);

    expect(handler).toBeDefined();
    await expect(handler?.({}, { mcpReq: { signal: controller.signal } })).rejects.toThrow(
      "request cancelled",
    );
  });
});
