import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatScenarioResult,
  loadScenario,
  runScenarioCommand,
} from "../../src/scenarioCommand.js";

const temporaryDirectories: string[] = [];

async function writeScenario(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mcp-failure-lab-scenario-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "scenario.json");
  await writeFile(path, contents, "utf8");
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("scenario files", () => {
  it("loads a valid JSON scenario", async () => {
    const path = await writeScenario(
      JSON.stringify({
        name: "ping succeeds",
        call: { tool: "ping", args: {} },
        expect: { outcome: "success", maxDurationMs: 1000 },
      }),
    );

    await expect(loadScenario(path)).resolves.toEqual({
      name: "ping succeeds",
      call: { tool: "ping", args: {} },
      timeoutMs: 30_000,
      expect: { outcome: "success", maxDurationMs: 1000 },
    });
  });

  it("preserves an explicit scenario timeout", async () => {
    const path = await writeScenario(
      JSON.stringify({
        name: "bounded timeout",
        call: { tool: "hang", args: {} },
        timeoutMs: 25,
        expect: { outcome: "timeout" },
      }),
    );

    await expect(loadScenario(path)).resolves.toMatchObject({ timeoutMs: 25 });
  });

  it("reports invalid JSON with the scenario path", async () => {
    const path = await writeScenario("{");

    await expect(loadScenario(path)).rejects.toThrow(`scenario file ${path} is not valid JSON`);
  });

  it("rejects scenario fields outside the schema", async () => {
    const path = await writeScenario(
      JSON.stringify({
        name: "unexpected field",
        call: { tool: "ping", args: {} },
        expect: { outcome: "success" },
        extra: true,
      }),
    );

    await expect(loadScenario(path)).rejects.toThrow(`scenario file ${path} is invalid`);
  });
});

describe("scenario reports", () => {
  it("formats assertion failures for the console", () => {
    const report = formatScenarioResult(
      {
        name: "expected timeout",
        outcome: "success",
        durationMs: 12.5,
        passed: false,
        failures: ["expected outcome timeout, received success"],
      },
      "console",
    );

    expect(report).toContain("Scenario: expected timeout");
    expect(report).toContain("Assertions: failed");
    expect(report).toContain("- expected outcome timeout, received success");
  });

  it("emits a stable JSON summary", () => {
    const report = JSON.parse(
      formatScenarioResult(
        {
          name: "ping succeeds",
          outcome: "success",
          durationMs: 5,
          passed: true,
          failures: [],
        },
        "json",
      ),
    );

    expect(report).toEqual({
      name: "ping succeeds",
      outcome: "success",
      durationMs: 5,
      passed: true,
      failures: [],
    });
  });
});

describe("scenario command", () => {
  it("runs a scenario through an in-memory MCP connection", async () => {
    const path = await writeScenario(
      JSON.stringify({
        name: "ping succeeds",
        call: { tool: "ping", args: {} },
        expect: { outcome: "success", maxDurationMs: 1000 },
      }),
    );
    const output = { write: vi.fn(), writeError: vi.fn() };

    await expect(runScenarioCommand(path, "json", output)).resolves.toBe(0);
    expect(output.writeError).not.toHaveBeenCalled();
    expect(JSON.parse(output.write.mock.calls[0]?.[0] as string)).toMatchObject({
      name: "ping succeeds",
      outcome: "success",
      passed: true,
    });
  });

  it("uses exit code 2 when scenario assertions fail", async () => {
    const path = await writeScenario(
      JSON.stringify({
        name: "ping should time out",
        call: { tool: "ping", args: {} },
        expect: { outcome: "timeout" },
      }),
    );
    const output = { write: vi.fn(), writeError: vi.fn() };

    await expect(runScenarioCommand(path, "console", output)).resolves.toBe(2);
    expect(output.write).toHaveBeenCalledWith(expect.stringContaining("Assertions: failed"));
  });

  it("uses exit code 1 when the scenario cannot be loaded", async () => {
    const output = { write: vi.fn(), writeError: vi.fn() };

    await expect(runScenarioCommand("missing.json", "console", output)).resolves.toBe(1);
    expect(output.write).not.toHaveBeenCalled();
    expect(output.writeError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to run scenario: cannot read scenario file missing.json"),
    );
  });
});
