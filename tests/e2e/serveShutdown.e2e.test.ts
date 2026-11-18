import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

const host = "127.0.0.1";
const deadlineMs = 10_000;
const children = new Set<ChildProcessWithoutNullStreams>();

function launch(...args: string[]): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, ["dist/cli.js", "serve", ...args], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  child.once("close", () => children.delete(child));
  return child;
}

function untilOutput(
  stream: NodeJS.ReadableStream,
  matches: (output: string) => boolean,
  child: ChildProcessWithoutNullStreams,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => finish(new Error("Server readiness timed out")), deadlineMs);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      if (matches(output)) finish();
    };
    const onClose = (): void => finish(new Error("Server exited before readiness"));
    const onError = (error: Error): void => finish(error);
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      stream.off("data", onData);
      child.off("close", onClose);
      child.off("error", onError);
      if (error) reject(error);
      else resolve(output);
    };
    stream.on("data", onData);
    child.once("close", onClose);
    child.once("error", onError);
  });
}

function exitOf(
  child: ChildProcessWithoutNullStreams,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(
      () => reject(new Error("Server did not exit after signal")),
      deadlineMs,
    );
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No TCP port allocated");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function canBind(port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  await Promise.all(
    [...children].map(async (child) => {
      child.kill("SIGKILL");
      await exitOf(child);
    }),
  );
});

describe.skipIf(process.platform === "win32")("serve shutdown signals", () => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    it(`closes the stdio server on ${signal}`, async () => {
      const child = launch();
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "shutdown-test", version: "1" },
          },
        })}\n`,
      );
      await untilOutput(child.stdout, (output) => output.includes('"id":1'), child);
      const exited = exitOf(child);
      child.kill(signal);
      expect(await exited).toEqual({ code: 0, signal: null });
      expect(stderr).toContain(`Received ${signal}; shutting down.`);
      expect(
        stdout
          .trim()
          .split("\n")
          .every((line) => JSON.parse(line) !== null),
      ).toBe(true);
    });

    it(`releases the HTTP listener on ${signal}`, async () => {
      const port = await availablePort();
      const child = launch("--transport", "http", "--host", host, "--port", String(port));
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      await untilOutput(
        child.stderr,
        (output) => output.includes(`listening at http://${host}:${port}/mcp`),
        child,
      );
      const response = await fetch(`http://${host}:${port}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-11-25",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "shutdown-test", version: "1" },
          },
        }),
      });
      expect(response.ok).toBe(true);
      await response.body?.cancel();
      const exited = exitOf(child);
      child.kill(signal);
      expect(await exited).toEqual({ code: 0, signal: null });
      expect(stderr).toContain(`Received ${signal}; shutting down.`);
      expect(stdout).toBe("");
      await canBind(port);
    });
  }
});
