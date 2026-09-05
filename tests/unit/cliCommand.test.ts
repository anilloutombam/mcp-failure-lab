import { describe, expect, it, vi } from "vitest";

import { runCliCommand, type CliDependencies } from "../../src/cliCommand.js";
import { VERSION } from "../../src/version.js";

function createOutput() {
  return {
    write: vi.fn(),
    writeError: vi.fn(),
  };
}

function createDependencies(): CliDependencies {
  return {
    serve: vi.fn().mockResolvedValue(undefined),
    runDemo: vi.fn().mockResolvedValue(0),
  };
}

describe("CLI command", () => {
  it("prints help when no command is provided", async () => {
    const output = createOutput();
    const dependencies = createDependencies();

    await expect(runCliCommand([], output, dependencies)).resolves.toBe(0);

    expect(output.write).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    expect(output.writeError).not.toHaveBeenCalled();
  });

  it("prints help for --help", async () => {
    const output = createOutput();
    const dependencies = createDependencies();

    await expect(runCliCommand(["--help"], output, dependencies)).resolves.toBe(0);

    expect(output.write).toHaveBeenCalledWith(
      expect.stringContaining("mcp-failure-lab <command> [options]"),
    );
    expect(output.write).toHaveBeenCalledWith(expect.stringContaining("--target <file>"));
    expect(output.writeError).not.toHaveBeenCalled();
  });

  it("prints the current version", async () => {
    const output = createOutput();
    const dependencies = createDependencies();

    await expect(runCliCommand(["--version"], output, dependencies)).resolves.toBe(0);

    expect(output.write).toHaveBeenCalledWith(VERSION);
    expect(output.writeError).not.toHaveBeenCalled();
  });

  it("dispatches the serve command", async () => {
    const output = createOutput();
    const dependencies = createDependencies();

    await expect(runCliCommand(["serve"], output, dependencies)).resolves.toBe(0);

    expect(dependencies.serve).toHaveBeenCalledOnce();
    expect(dependencies.serve).toHaveBeenCalledWith({
      transport: "stdio",
      host: "127.0.0.1",
      port: 3000,
      path: "/mcp",
    });
    expect(dependencies.runDemo).not.toHaveBeenCalled();
  });

  it("dispatches the serve command with HTTP options", async () => {
    const output = createOutput();
    const dependencies = createDependencies();

    await expect(
      runCliCommand(
        ["serve", "--transport", "http", "--host", "localhost", "--port", "4000"],
        output,
        dependencies,
      ),
    ).resolves.toBe(0);

    expect(dependencies.serve).toHaveBeenCalledWith({
      transport: "http",
      host: "localhost",
      port: 4000,
      path: "/mcp",
    });
  });

  it("rejects invalid serve options without starting a server", async () => {
    const output = createOutput();
    const dependencies = createDependencies();

    await expect(
      runCliCommand(["serve", "--transport", "websocket"], output, dependencies),
    ).resolves.toBe(1);

    expect(output.writeError).toHaveBeenCalledWith("--transport must be either stdio or http");
    expect(dependencies.serve).not.toHaveBeenCalled();
  });

  it("dispatches the demo command and returns its exit code", async () => {
    const output = createOutput();
    const dependencies = createDependencies();

    vi.mocked(dependencies.runDemo).mockResolvedValue(2);

    await expect(runCliCommand(["demo"], output, dependencies)).resolves.toBe(2);

    expect(dependencies.runDemo).toHaveBeenCalledOnce();
    expect(dependencies.runDemo).toHaveBeenCalledWith(output);
    expect(dependencies.serve).not.toHaveBeenCalled();
  });

  it("rejects unknown commands", async () => {
    const output = createOutput();
    const dependencies = createDependencies();

    await expect(runCliCommand(["unknown-command"], output, dependencies)).resolves.toBe(1);

    expect(output.write).not.toHaveBeenCalled();

    expect(output.writeError).toHaveBeenCalledWith("Unknown command: unknown-command");

    expect(output.writeError).toHaveBeenCalledWith("Run with --help to see available commands.");

    expect(dependencies.serve).not.toHaveBeenCalled();
    expect(dependencies.runDemo).not.toHaveBeenCalled();
  });

  it("returns 1 when run arguments are invalid", async () => {
    const output = createOutput();
    const dependencies = createDependencies();

    await expect(runCliCommand(["run"], output, dependencies)).resolves.toBe(1);

    expect(output.write).not.toHaveBeenCalled();
    expect(output.writeError).toHaveBeenCalledWith(
      expect.stringContaining("Missing scenario file"),
    );
  });

  it("dispatches valid run arguments", async () => {
    const output = createOutput();
    const dependencies = createDependencies();

    await expect(
      runCliCommand(["run", "missing.json", "--target", "target.json"], output, dependencies),
    ).resolves.toBe(1);

    expect(output.writeError).toHaveBeenCalledWith(
      expect.stringContaining("cannot read scenario file missing.json"),
    );
  });
});
