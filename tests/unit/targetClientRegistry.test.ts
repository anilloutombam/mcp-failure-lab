import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpTargetConfigSchema } from "../../src/mcpTargetClientAdapter.js";
import {
  TargetClientAdapterRegistry,
  loadTargetClient,
  type TargetClientAdapterProvider,
} from "../../src/targetClientRegistry.js";

const temporaryDirectories: string[] = [];

async function writeTarget(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mcp-failure-lab-target-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "target.json");
  await writeFile(path, contents, "utf8");
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("target-client adapter registry", () => {
  it("resolves a registered provider and delegates configuration validation", () => {
    const run = vi.fn();
    const provider: TargetClientAdapterProvider = {
      name: "custom",
      resolve: vi.fn(() => ({ name: "custom", run })),
    };
    const registry = new TargetClientAdapterRegistry([provider]);
    expect(registry.resolve({ adapter: "custom", config: { endpoint: "local" } })).toEqual({
      name: "custom",
      run,
    });
    expect(provider.resolve).toHaveBeenCalledWith({ endpoint: "local" });
  });

  it("rejects duplicate and unknown adapters", () => {
    const provider: TargetClientAdapterProvider = { name: "custom", resolve: vi.fn() };
    expect(() => new TargetClientAdapterRegistry([provider, provider])).toThrow(
      "target-client adapter is already registered: custom",
    );
    expect(() =>
      new TargetClientAdapterRegistry().resolve({ adapter: "missing", config: {} }),
    ).toThrow("unknown target-client adapter: missing");
  });

  it("loads and resolves a target file", async () => {
    const run = vi.fn();
    const provider: TargetClientAdapterProvider = {
      name: "custom",
      resolve: vi.fn(() => ({ name: "custom", run })),
    };
    const path = await writeTarget(
      JSON.stringify({ adapter: "custom", config: { endpoint: "local" } }),
    );

    await expect(
      loadTargetClient(path, new TargetClientAdapterRegistry([provider])),
    ).resolves.toEqual({ name: "custom", run });
    expect(provider.resolve).toHaveBeenCalledWith({ endpoint: "local" });
  });

  it("reports unreadable and invalid target files with their paths", async () => {
    const missingPath = join(tmpdir(), `missing-target-${Date.now()}.json`);
    const invalidPath = await writeTarget("{");
    const registry = new TargetClientAdapterRegistry();

    await expect(loadTargetClient(missingPath, registry)).rejects.toThrow(
      `cannot read target file ${missingPath}`,
    );
    await expect(loadTargetClient(invalidPath, registry)).rejects.toThrow(
      `target file ${invalidPath} is invalid`,
    );
  });
});

describe("MCP target configuration", () => {
  it("accepts HTTP and stdio transports", () => {
    expect(
      mcpTargetConfigSchema.parse({ transport: "http", url: "https://example.com/mcp" }),
    ).toMatchObject({ transport: "http" });
    expect(mcpTargetConfigSchema.parse({ transport: "stdio", command: "server" })).toMatchObject({
      transport: "stdio",
    });
  });

  it("rejects unsupported transports and unknown fields", () => {
    expect(() =>
      mcpTargetConfigSchema.parse({ transport: "sse", url: "https://example.com" }),
    ).toThrow();
    expect(() =>
      mcpTargetConfigSchema.parse({
        transport: "http",
        url: "https://example.com/mcp",
        token: "plaintext",
      }),
    ).toThrow();
  });

  it("rejects unsafe HTTP targets and credential transmission", () => {
    expect(() =>
      mcpTargetConfigSchema.parse({ transport: "http", url: "http://example.com/mcp" }),
    ).toThrow("cleartext HTTP is allowed only for loopback targets");
    expect(() =>
      mcpTargetConfigSchema.parse({
        transport: "http",
        url: "http://127.0.0.1:3000/mcp",
        headerEnv: { Authorization: "TOKEN" },
      }),
    ).toThrow("HTTP targets with headers must use HTTPS");
  });

  it("allows credential-free loopback HTTP targets", () => {
    expect(
      mcpTargetConfigSchema.parse({ transport: "http", url: "http://127.0.0.1:3000/mcp" }),
    ).toMatchObject({ transport: "http" });
    expect(
      mcpTargetConfigSchema.parse({ transport: "http", url: "http://[::1]:3000/mcp" }),
    ).toMatchObject({ transport: "http" });
  });
});
