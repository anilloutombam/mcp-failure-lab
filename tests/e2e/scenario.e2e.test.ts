import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../helpers/runCli.js";

interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const temporaryDirectories: string[] = [];

async function writeScenario(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mcp-failure-lab-e2e-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "scenario.json");
  await writeFile(path, contents, "utf8");
  return path;
}

// async function runCli(...args: string[]): Promise<CliResult> {
//   const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
//     cwd: process.cwd(),
//     env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
//     stdio: ["ignore", "pipe", "pipe"],
//   });
//   let stdout = "";
//   let stderr = "";

//   child.stdout.setEncoding("utf8");
//   child.stderr.setEncoding("utf8");
//   child.stdout.on("data", (chunk: string) => {
//     stdout += chunk;
//   });
//   child.stderr.on("data", (chunk: string) => {
//     stderr += chunk;
//   });

//   const exitCode = await new Promise<number | null>((resolve, reject) => {
//     child.once("error", reject);
//     child.once("close", resolve);
//   });

//   return { exitCode, stdout, stderr };
// }

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("scenario CLI", () => {
  it("runs the documented example successfully", async () => {
    const result = await runCli("run", "examples/scenarios/delay-success.json");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("Scenario: bounded delay succeeds");
    expect(result.stdout).toContain("Assertions: passed");
  });

  it("writes a machine-readable JSON report", async () => {
    const result = await runCli("run", "examples/scenarios/delay-success.json", "--report", "json");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      name: "bounded delay succeeds",
      outcome: "success",
      passed: true,
    });
  });

  it("uses exit code 2 when assertions fail", async () => {
    const path = await writeScenario(
      JSON.stringify({
        name: "ping should time out",
        call: { tool: "ping", args: {} },
        expect: { outcome: "timeout" },
      }),
    );

    const result = await runCli("run", path);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("Assertions: failed");
    expect(result.stderr).toBe("");
  });

  it("uses exit code 1 for invalid JSON", async () => {
    const path = await writeScenario("{");

    const result = await runCli("run", path);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("is not valid JSON");
  });

  it("writes invalid JSON failures as a JSON report", async () => {
    const path = await writeScenario("{");

    const result = await runCli("run", path, "--report", "json");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      passed: false,
      error: { code: "scenario_load_failed" },
    });
  });

  it("rejects missing files and unknown options", async () => {
    const missingFile = await runCli("run");
    const unknownOption = await runCli("run", "examples/scenarios/delay-success.json", "--unknown");

    expect(missingFile.exitCode).toBe(1);
    expect(missingFile.stderr).toContain("Missing scenario file");
    expect(unknownOption.exitCode).toBe(1);
    expect(unknownOption.stderr).toContain("Unknown run option: --unknown");
  });

  it("writes argument failures as JSON when requested", async () => {
    const result = await runCli("run", "--unknown", "--report", "json");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      passed: false,
      error: {
        code: "invalid_arguments",
        message: "Unknown run option: --unknown",
      },
    });
  });

  it("times out and cleans up a hanging scenario", async () => {
    const path = await writeScenario(
      JSON.stringify({
        name: "hang is bounded",
        call: { tool: "hang", args: {} },
        timeoutMs: 10,
        expect: { outcome: "timeout", maxDurationMs: 1000 },
      }),
    );

    const result = await runCli("run", path);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("Outcome: timeout");
    expect(result.stdout).toContain("Assertions: passed");
  });
});
