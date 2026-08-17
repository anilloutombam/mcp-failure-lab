import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function readPackageVersion(): Promise<string> {
  const contents = await readFile("package.json", "utf8");
  const parsed = JSON.parse(contents) as { version: string };
  return parsed.version;
}

interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function runCli(...args: string[]): Promise<CliResult> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  return { exitCode, stdout, stderr };
}

describe("cli entrypoint", () => {
  it("prints the current version with --version", async () => {
    const [result, expectedVersion] = await Promise.all([runCli("--version"), readPackageVersion()]);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout.trim()).toBe(expectedVersion);
  });

  it("prints the current version with -v", async () => {
    const [result, expectedVersion] = await Promise.all([runCli("-v"), readPackageVersion()]);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout.trim()).toBe(expectedVersion);
  });

  it("keeps the CLI version in sync with package.json", async () => {
    const [result, expectedVersion] = await Promise.all([runCli("--version"), readPackageVersion()]);

    expect(result.stdout.trim()).toBe("0.3.0");
    expect(expectedVersion).toBe("0.3.0");
  });

  it("prints help text when no command is given", async () => {
    const result = await runCli();

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("MCP Failure Lab");
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("mcp-failure-lab <command> [options]");
    expect(result.stdout).toContain("run <file>");
  });

  it("prints help text with the help command", async () => {
    const result = await runCli("help");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("Commands:");
  });

  it("prints help text with --help", async () => {
    const result = await runCli("--help");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("Options:");
  });

  it("prints help text with -h", async () => {
    const result = await runCli("-h");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("Show this help message");
  });

  it("rejects unknown commands with exit code 1", async () => {
    const result = await runCli("does-not-exist");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown command: does-not-exist");
    expect(result.stderr).toContain("Run with --help to see available commands.");
  });
});