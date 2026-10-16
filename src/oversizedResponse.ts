import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

/** The generated text is ASCII, so its character and UTF-8 byte counts match. */
export const MAX_RESPONSE_PAYLOAD_BYTES = 256 * 1024;

export function registerOversizedResponseTool(server: McpServer): void {
  server.registerTool(
    "oversized_response",
    {
      description:
        "Return a deterministic text payload of exactly sizeBytes UTF-8 bytes (maximum 256 KiB).",
      inputSchema: z.object({
        sizeBytes: z.number().int().finite().min(0).max(MAX_RESPONSE_PAYLOAD_BYTES),
      }),
    },
    async ({ sizeBytes }) => ({
      content: [{ type: "text", text: "x".repeat(sizeBytes) }],
    }),
  );
}
