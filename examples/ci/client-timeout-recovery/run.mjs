import { Client, SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const client = new Client({ name: "failure-lab-ci-example", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/cli.js", "serve"],
  cwd: process.cwd(),
  stderr: "inherit",
});

try {
  await client.connect(transport);

  try {
    await client.callTool({ name: "delay", arguments: { delayMs: 1_000 } }, { timeout: 100 });
    throw new Error("delay unexpectedly completed before the client deadline");
  } catch (error) {
    if (!(error instanceof SdkError) || error.code !== SdkErrorCode.RequestTimeout) throw error;
    console.log("timeout: observed");
  }

  const ping = await client.callTool({ name: "ping", arguments: {} }, { timeout: 2_000 });
  const text = ping.content.find((item) => item.type === "text")?.text;
  if (typeof text !== "string" || JSON.parse(text).status !== "ok") {
    throw new Error("follow-up ping did not return the expected status");
  }

  console.log("follow-up ping: passed");
  console.log("connection recovery: passed");
} finally {
  await client.close().catch(() => undefined);
}
