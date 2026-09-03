import { describe, expect, it, vi } from "vitest";
import { mcpTargetConfigSchema } from "../../src/mcpTargetClientAdapter.js";
import {
  TargetClientAdapterRegistry,
  type TargetClientAdapterProvider,
} from "../../src/targetClientRegistry.js";

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
});
