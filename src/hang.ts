import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export function waitForCancellation(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const rejectWithAbort = () => {
      reject(signal.reason ?? new DOMException("The request was cancelled.", "AbortError"));
    };

    if (signal.aborted) {
      rejectWithAbort();
      return;
    }

    signal.addEventListener("abort", rejectWithAbort, { once: true });
  });
}

export function registerHangTool(server: McpServer): void {
  server.registerTool(
    "hang",
    {
      description: "Never respond unless the MCP request is cancelled.",
      inputSchema: z.object({}),
    },
    async (_args, context) => waitForCancellation(context.mcpReq.signal),
  );
}
