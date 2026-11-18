import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

const host = "127.0.0.1";
const deadlineMs = 10_000;
const children = new Set<ChildProcessWithoutNullStreams>();
const closed = new WeakMap<
  ChildProcessWithoutNullStreams,
  Promise<{ code: number | null; signal: NodeJS.Signals | null }>
>();

function launch(...args: string[]): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, ["dist/cli.js", "serve", ...args], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  closed.set(
    child,
    new Promise((resolve) => {
      child.once("close", (code, signal) => {
        children.delete(child);
        resolve({ code, signal });
      });
    }),
  );
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

async function exitOf(
  child: ChildProcessWithoutNullStreams,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const completion = closed.get(child);
  if (!completion) throw new Error("Child completion was not recorded");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      completion,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Server did not close after signal")),
          deadlineMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function messages(output: string): Record<string, unknown>[] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const message: unknown = JSON.parse(line);
      if (
        typeof message !== "object" ||
        message === null ||
        Array.isArray(message) ||
        !("jsonrpc" in message) ||
        message.jsonrpc !== "2.0" ||
        !(
          ("method" in message && typeof message.method === "string") ||
          ("id" in message && (typeof message.id === "number" || typeof message.id === "string"))
        )
      ) {
        throw new Error(`Non-protocol output on stdout: ${line}`);
      }
      return message as Record<string, unknown>;
    });
}

function initialized(output: string): boolean {
  return (
    output.includes("\n") &&
    messages(output.slice(0, output.lastIndexOf("\n"))).some(
      (message) =>
        message.id === 1 && typeof message.result === "object" && message.result !== null,
    )
  );
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
      await untilOutput(child.stdout, initialized, child);
      const exited = exitOf(child);
      child.kill(signal);
      expect(await exited).toEqual({ code: 0, signal: null });
      expect(stderr).toContain(`Received ${signal}; shutting down.`);
      expect(messages(stdout)).toEqual([
        expect.objectContaining({ jsonrpc: "2.0", id: 1, result: expect.any(Object) }),
      ]);
    }, 25_000);

    it(`releases the HTTP listener on ${signal}`, async () => {
      let port = 0;
      let child: ChildProcessWithoutNullStreams | undefined;
      let stdout = "";
      let stderr = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        port = await availablePort();
        child = launch("--transport", "http", "--host", host, "--port", String(port));
        stdout = "";
        stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        try {
          await untilOutput(
            child.stderr,
            (output) => output.includes(`listening at http://${host}:${port}/mcp`),
            child,
          );
          break;
        } catch (error) {
          if (!stderr.includes("EADDRINUSE") || attempt === 2) throw error;
          await exitOf(child);
        }
      }
      if (!child) throw new Error("HTTP server was not started");
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
      expect(response.headers.get("mcp-session-id")).toBeTruthy();
      const body = await response.text();
      const payloads = body.split(/\r?\n\r?\n/).flatMap((event) =>
        event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => JSON.parse(line.slice(5)) as Record<string, unknown>),
      );
      expect(payloads).toContainEqual(
        expect.objectContaining({ jsonrpc: "2.0", id: 1, result: expect.any(Object) }),
      );
      const exited = exitOf(child);
      child.kill(signal);
      expect(await exited).toEqual({ code: 0, signal: null });
      expect(stderr).toContain(`Received ${signal}; shutting down.`);
      expect(stdout).toBe("");
      await canBind(port);
    }, 25_000);
  }
});
