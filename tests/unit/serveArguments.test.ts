import { describe, expect, it } from "vitest";

import { parseServeArguments } from "../../src/serveArguments.js";

describe("serve command arguments", () => {
  it("uses safe stdio defaults", () => {
    expect(parseServeArguments([])).toEqual({
      ok: true,
      options: {
        transport: "stdio",
        host: "127.0.0.1",
        port: 3000,
        path: "/mcp",
      },
    });
  });

  it("accepts explicit HTTP configuration", () => {
    expect(
      parseServeArguments([
        "--transport",
        "http",
        "--host",
        "localhost",
        "--port",
        "4321",
        "--path",
        "/custom-mcp",
      ]),
    ).toEqual({
      ok: true,
      options: {
        transport: "http",
        host: "localhost",
        port: 4321,
        path: "/custom-mcp",
      },
    });
  });

  it.each([
    [["--transport", "websocket"], "--transport must be either stdio or http"],
    [["--transport"], "--transport must be either stdio or http"],
    [["--transport", "http", "--host", "http://localhost"], "--host must be"],
    [["--transport", "http", "--port", "0"], "--port must be"],
    [["--transport", "http", "--port", "65536"], "--port must be"],
    [["--transport", "http", "--path", "mcp"], "--path must be"],
    [["--transport", "http", "--path", "/mcp?token=x"], "--path must be"],
    [["--unknown"], "Unknown serve option"],
  ])("rejects invalid arguments %j", (args, message) => {
    expect(parseServeArguments(args)).toEqual({
      ok: false,
      error: expect.stringContaining(message),
    });
  });

  it("rejects HTTP-only options in stdio mode", () => {
    expect(parseServeArguments(["--port", "4000"])).toEqual({
      ok: false,
      error: "--host, --port, and --path require --transport http",
    });
  });
});
