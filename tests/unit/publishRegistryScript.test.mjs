import { describe, expect, it, vi } from "vitest";

import { publishRegistry } from "../../scripts/publish-registry.mjs";

const server = {
  $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  name: "io.github.example/server",
  description: "Example server",
  version: "1.2.3",
};

function options(overrides = {}) {
  return {
    readServer: vi.fn().mockResolvedValue(JSON.stringify(server)),
    publish: vi.fn().mockResolvedValue(undefined),
    fetchVersion: vi.fn(),
    ...overrides,
  };
}

describe("MCP Registry publishing", () => {
  it("does not query the registry after a successful publish", async () => {
    const input = options();

    await publishRegistry(input);

    expect(input.fetchVersion).not.toHaveBeenCalled();
  });

  it("accepts an exact existing version after an ambiguous publish failure", async () => {
    const input = options({
      publish: vi.fn().mockRejectedValue(new Error("connection reset")),
      fetchVersion: vi.fn().mockResolvedValue(Response.json({ server })),
    });

    await expect(publishRegistry(input)).resolves.toBeUndefined();
    expect(input.fetchVersion).toHaveBeenCalledWith(
      "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.example%2Fserver/versions/1.2.3",
      { headers: { accept: "application/json" } },
    );
  });

  it("fails when the existing version has different metadata", async () => {
    const input = options({
      publish: vi.fn().mockRejectedValue(new Error("duplicate version")),
      fetchVersion: vi
        .fn()
        .mockResolvedValue(
          Response.json({ server: { ...server, description: "Different server" } }),
        ),
    });

    await expect(publishRegistry(input)).rejects.toThrow("metadata does not match server.json");
  });

  it("fails when the version cannot be found after publishing fails", async () => {
    const input = options({
      publish: vi.fn().mockRejectedValue(new Error("connection reset")),
      fetchVersion: vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    });

    await expect(publishRegistry(input)).rejects.toThrow("lookup returned HTTP 404");
  });
});
