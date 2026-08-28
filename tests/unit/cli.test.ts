import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  createServer: vi.fn(() => ({ name: "test-server" })),
  runCliCommand: vi.fn(
    async (
      _args: string[],
      _output: unknown,
      _dependencies: {
        serve: (options: {
          transport: "stdio" | "http";
          host: string;
          port: number;
          path: string;
        }) => Promise<void>;
      },
    ) => 0,
  ),
  serveStdio: vi.fn((factory: () => unknown) => {
    factory();
    return { close: mocks.close };
  }),
  startHttpServer: vi.fn(async () => ({
    url: new URL("http://127.0.0.1:3000/mcp"),
    close: mocks.close,
  })),
}));

vi.mock("@modelcontextprotocol/server/stdio", () => ({
  serveStdio: mocks.serveStdio,
}));

vi.mock("../../src/server.js", () => ({
  createServer: mocks.createServer,
}));

vi.mock("../../src/httpServer.js", () => ({
  startHttpServer: mocks.startHttpServer,
}));

vi.mock("../../src/demoCommand.js", () => ({
  runDemoCommand: vi.fn(),
}));

vi.mock("../../src/cliCommand.js", () => ({
  runCliCommand: mocks.runCliCommand,
}));

const originalSigintListeners = process.listeners("SIGINT");
const originalSigtermListeners = process.listeners("SIGTERM");

describe("CLI server lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    for (const listener of process.listeners("SIGINT")) {
      if (!originalSigintListeners.includes(listener)) process.off("SIGINT", listener);
    }
    for (const listener of process.listeners("SIGTERM")) {
      if (!originalSigtermListeners.includes(listener)) process.off("SIGTERM", listener);
    }
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("creates an era-aware server and closes it on shutdown", async () => {
    await import("../../src/cli.js");
    const dependencies = mocks.runCliCommand.mock.calls[0]?.[2];

    expect(dependencies).toBeDefined();
    await dependencies?.serve({
      transport: "stdio",
      host: "127.0.0.1",
      port: 3000,
      path: "/mcp",
    });

    expect(mocks.serveStdio).toHaveBeenCalledWith(expect.any(Function), { legacy: "serve" });
    expect(mocks.createServer).toHaveBeenCalledOnce();

    process.emit("SIGINT");
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
  });

  it("starts the Streamable HTTP server and closes it on shutdown", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await import("../../src/cli.js");
    const dependencies = mocks.runCliCommand.mock.calls[0]?.[2];
    const options = {
      transport: "http" as const,
      host: "127.0.0.1",
      port: 3000,
      path: "/mcp",
    };

    expect(dependencies).toBeDefined();
    await dependencies?.serve(options);

    expect(mocks.startHttpServer).toHaveBeenCalledWith(options);
    expect(consoleError).toHaveBeenCalledWith(
      "MCP Failure Lab listening at http://127.0.0.1:3000/mcp",
    );

    process.emit("SIGTERM");
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
  });
});
