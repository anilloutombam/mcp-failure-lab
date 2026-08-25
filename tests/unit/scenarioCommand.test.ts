import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatScenarioResult,
  loadScenario,
  runScenarioCommand,
  writeScenarioCommandError,
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

  it("loads result expectations from a JSON scenario", async () => {
    const path = await writeScenario(
      JSON.stringify({
        name: "delay result matches",
        call: { tool: "delay", args: { delayMs: 25 } },
        expect: {
          outcome: "success",
          result: { isError: false, textContains: '"status":"delayed"' },
        },
      }),
    );

    await expect(loadScenario(path)).resolves.toMatchObject({
      expect: {
        outcome: "success",
        result: { isError: false, textContains: '"status":"delayed"' },
      },
    });
  });

  it("rejects invalid result expectation fields", async () => {
    const path = await writeScenario(
      JSON.stringify({
        name: "invalid result expectation",
        call: { tool: "ping", args: {} },
        expect: { outcome: "success", result: { textMatches: "ok" } },
      }),
    );

    await expect(loadScenario(path)).rejects.toThrow(`scenario file ${path} is invalid`);
  });

  it("rejects invalid result expectation values", async () => {
    const path = await writeScenario(
      JSON.stringify({
        name: "invalid result expectation value",
        call: { tool: "ping", args: {} },
        expect: { outcome: "success", result: { isError: "false" } },
      }),
    );

    await expect(loadScenario(path)).rejects.toThrow(`scenario file ${path} is invalid`);
  });

  it("loads an observer from a JSON scenario", async () => {
    const path = await writeScenario(
      JSON.stringify({
        name: "server remains responsive",
        call: { tool: "delay", args: { delayMs: 25 } },
        expect: { outcome: "success" },
        observe: {
          call: { tool: "ping", args: {} },
          timeoutMs: 1000,
          expect: {
            outcome: "success",
            result: { isError: false, textContains: '"status":"ok"' },
          },
        },
      }),
    );

    await expect(loadScenario(path)).resolves.toMatchObject({
      observe: {
        call: { tool: "ping", args: {} },
        timeoutMs: 1000,
        expect: {
          outcome: "success",
          result: { isError: false, textContains: '"status":"ok"' },
        },
      },
    });
  });

  it("applies the default timeout to an observer", async () => {
    const path = await writeScenario(
      JSON.stringify({
        name: "observer uses the default timeout",
        call: { tool: "ping", args: {} },
        expect: { outcome: "success" },
        observe: {
          call: { tool: "ping", args: {} },
          expect: { outcome: "success" },
        },
      }),
    );

    await expect(loadScenario(path)).resolves.toMatchObject({
      observe: { timeoutMs: 30_000 },
    });
  });

  it("rejects observer fields outside the schema", async () => {
    const path = await writeScenario(
      JSON.stringify({
        name: "invalid observer",
        call: { tool: "ping", args: {} },
        expect: { outcome: "success" },
        observe: {
          call: { tool: "ping", args: {} },
          expect: { outcome: "success" },
          retries: 2,
        },
      }),
    );

    await expect(loadScenario(path)).rejects.toThrow(`scenario file ${path} is invalid`);
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

  it("emits a stable JSON command error", () => {
    const output = { write: vi.fn(), writeError: vi.fn() };

    writeScenarioCommandError(
      "scenario_load_failed",
      "Failed to run scenario: missing file",
      "json",
      output,
    );

    expect(JSON.parse(output.write.mock.calls[0]?.[0] as string)).toEqual({
      passed: false,
      error: {
        code: "scenario_load_failed",
        message: "Failed to run scenario: missing file",
      },
    });
    expect(output.writeError).not.toHaveBeenCalled();
  });
});

describe("scenario command", () => {
  it("runs a scenario through the modern in-process HTTP handler", async () => {
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

  it("writes load failures as JSON when requested", async () => {
    const output = { write: vi.fn(), writeError: vi.fn() };

    await expect(runScenarioCommand("missing.json", "json", output)).resolves.toBe(1);
    expect(output.writeError).not.toHaveBeenCalled();
    expect(JSON.parse(output.write.mock.calls[0]?.[0] as string)).toMatchObject({
      passed: false,
      error: { code: "scenario_load_failed" },
    });
  });
});
