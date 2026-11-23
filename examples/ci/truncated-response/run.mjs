import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const endpoint = process.argv[2];
const mode = endpoint === undefined ? "stdio" : "http";

function createClient(name) {
  return new Client({ name, version: "1.0.0" });
}

function createTransport() {
  return endpoint === undefined
    ? new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", "src/cli.ts", "serve"],
        cwd: process.cwd(),
        stderr: "inherit",
      })
    : new StreamableHTTPClientTransport(new URL(endpoint));
}

async function checkPing(client) {
  const result = await client.callTool({ name: "ping", arguments: {} }, { timeout: 2_000 });
  const text = result.content.find((item) => item.type === "text")?.text;
  if (typeof text !== "string" || JSON.parse(text).status !== "ok") {
    throw new Error("follow-up ping did not return the expected status");
  }
}

const client = createClient("truncated-response-example");
let fault;
let recovery;
try {
  await client.connect(createTransport());
  try {
    await client.callTool({ name: "truncated_response", arguments: {} }, { timeout: 1_000 });
  } catch (error) {
    fault = {
      outcome: "rejected",
      name: error instanceof Error ? error.name : typeof error,
      code: typeof error === "object" && error !== null && "code" in error ? error.code : null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (fault === undefined) throw new Error("truncated response unexpectedly completed");
  if (mode === "http") {
    await checkPing(client);
    recovery = "same-session ping passed";
  }
} finally {
  await client.close().catch(() => undefined);
}

if (mode === "stdio") {
  const fresh = createClient("truncated-response-recovery");
  try {
    await fresh.connect(createTransport());
    await checkPing(fresh);
    recovery = "fresh-session ping passed";
  } finally {
    await fresh.close().catch(() => undefined);
  }
}

console.log(
  JSON.stringify({ mode, truncationPoint: "after-result-key", fault, recovery }, null, 2),
);
