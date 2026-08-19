import { describe, expect, it } from "vitest";

import { VERSION } from "../../src/version.js";
import { runCli } from "../helpers/runCli.js";

describe("CLI", () => {
  it("--help exits successfully and prints usage to stdout", async () => {
    const result = await runCli("--help");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("MCP Failure Lab");
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("mcp-failure-lab <command> [options]");
  });

  it("--version exits successfully and prints the current version to stdout", async () => {
    const result = await runCli("--version");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(VERSION);
  });

  it("unknown commands exit with code 1 and print a diagnostic to stderr", async () => {
    const result = await runCli("unknown-command");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown command: unknown-command");
    expect(result.stderr).toContain("Run with --help to see available commands.");
  });

  it("runs the built-in demo successfully", async () => {
    const result = await runCli("demo");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("MCP Failure Lab — Demo");
    expect(result.stdout).toContain("Scenario: Deterministic delay demo");
    expect(result.stdout).toContain("Outcome: success");
    expect(result.stdout).toContain("Assertions: passed");
  });
});
