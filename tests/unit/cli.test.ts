import { afterEach, describe, expect, it, vi } from "vitest";

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
}));

vi.mock("@modelcontextprotocol/server/stdio", () => ({
  serveStdio: mocks.serveStdio,
}));

vi.mock("../../src/server.js", () => ({
  createServer: mocks.createServer,
}));

vi.mock("../../src/demoCommand.js", () => ({
  runDemoCommand: vi.fn(),
}));

vi.mock("../../src/cliCommand.js", () => ({
  runCliCommand: mocks.runCliCommand,
}));

describe("CLI stdio lifecycle", () => {
  afterEach(() => {
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    vi.clearAllMocks();
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
});
