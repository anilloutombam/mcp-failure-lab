import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

const DEFAULT_REGISTRY_URL = "https://registry.modelcontextprotocol.io";

function runPublisher(serverPath, publisherPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(publisherPath, ["publish", serverPath], { stdio: "inherit" });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const outcome = signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
      reject(new Error(`mcp-publisher failed with ${outcome}`));
    });
  });
}

export async function publishRegistry({
  serverPath = "server.json",
  registryUrl = process.env.MCP_REGISTRY_URL ?? DEFAULT_REGISTRY_URL,
  publisherPath = process.env.MCP_PUBLISHER_PATH ?? "./mcp-publisher",
  readServer = (path) => readFile(path, "utf8"),
  fetchVersion = fetch,
  publish = () => runPublisher(serverPath, publisherPath),
} = {}) {
  const expected = JSON.parse(await readServer(serverPath));

  try {
    await publish();
    return;
  } catch (publishError) {
    const name = encodeURIComponent(expected.name);
    const version = encodeURIComponent(expected.version);
    const url = `${registryUrl.replace(/\/$/, "")}/v0.1/servers/${name}/versions/${version}`;
    const response = await fetchVersion(url, { headers: { accept: "application/json" } });

    if (!response.ok) {
      throw new Error(
        `MCP Registry publish failed and ${expected.name}@${expected.version} could not be reconciled: lookup returned HTTP ${response.status}`,
        { cause: publishError },
      );
    }

    const existing = await response.json();
    if (!isDeepStrictEqual(existing.server, expected)) {
      throw new Error(
        `MCP Registry already contains ${expected.name}@${expected.version}, but its metadata does not match server.json`,
        { cause: publishError },
      );
    }

    console.log(
      `MCP Registry already contains matching metadata for ${expected.name}@${expected.version}`,
    );
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishRegistry().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
