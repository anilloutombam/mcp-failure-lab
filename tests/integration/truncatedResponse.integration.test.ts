import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";

function createStdioClient(name: string): Client {
  return new Client(
    { name, version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
}

function createTransport(): StdioClientTransport {
  return new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/cli.ts", "serve"],
    cwd: process.cwd(),
    stderr: "pipe",
  });
}

describe("truncated stdio response", () => {
  it("rejects the incomplete JSON line and starts a fresh session cleanly", async () => {
    const affected = createStdioClient("truncated-stdio-test");
    const transport = createTransport();
    try {
      await affected.connect(transport);
      await expect(
        affected.callTool({ name: "truncated_response", arguments: {} }, { timeout: 1000 }),
      ).rejects.toThrow();
    } finally {
      await affected.close().catch(() => undefined);
    }

    const recovered = createStdioClient("truncated-stdio-recovery");
    try {
      await recovered.connect(createTransport());
      await expect(recovered.callTool({ name: "ping", arguments: {} })).resolves.toMatchObject({
        content: [{ type: "text" }],
      });
    } finally {
      await recovered.close();
    }
  });
});
