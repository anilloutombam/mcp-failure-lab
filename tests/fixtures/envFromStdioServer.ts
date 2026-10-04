import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

// Return only comparisons, never environment values, so the fixture cannot leak credentials.
serveStdio(
  () => {
    const server = new McpServer({ name: "env-from-fixture", version: "0.1.0" });
    server.registerTool("check_environment", { inputSchema: z.object({}) }, async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            mapped: process.env.LAB_CHILD_TOKEN === "fixture-token",
            literal: process.env.LAB_CHILD_MODE === "literal",
            empty: process.env.LAB_CHILD_EMPTY === "",
            unrelatedAbsent: process.env.LAB_UNMAPPED_SECRET === undefined,
          }),
        },
      ],
    }));
    return server;
  },
  { legacy: "serve" },
);
