import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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
      inputSchema: {},
    },
    async (_args, { signal }) => waitForCancellation(signal),
  );
}
