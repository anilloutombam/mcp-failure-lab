import { describe, expect, it } from "vitest";

import { parseRunArguments } from "../../src/runArguments.js";

describe("run command arguments", () => {
  it("uses console reporting by default", () => {
    expect(parseRunArguments(["scenario.json"])).toEqual({
      ok: true,
      path: "scenario.json",
      format: "console",
    });
  });

  it("accepts explicit console and JSON report formats", () => {
    expect(parseRunArguments(["scenario.json", "--report", "console"])).toEqual({
      ok: true,
      path: "scenario.json",
      format: "console",
    });
    expect(parseRunArguments(["scenario.json", "--report", "json"])).toEqual({
      ok: true,
      path: "scenario.json",
      format: "json",
    });
  });

  it("reports a missing scenario file", () => {
    expect(parseRunArguments([])).toEqual({
      ok: false,
      error: "Missing scenario file. Usage: mcp-failure-lab run <file> [--report console|json]",
      format: "console",
    });
  });

  it("rejects an unsupported report format", () => {
    expect(parseRunArguments(["scenario.json", "--report", "yaml"])).toEqual({
      ok: false,
      error: "--report must be either console or json",
      format: "console",
    });
  });

  it("rejects unknown options", () => {
    expect(parseRunArguments(["scenario.json", "--unknown"])).toEqual({
      ok: false,
      error: "Unknown run option: --unknown",
      format: "console",
    });
  });

  it("rejects extra positional arguments", () => {
    expect(parseRunArguments(["first.json", "second.json"])).toEqual({
      ok: false,
      error: "Unexpected run argument: second.json",
      format: "console",
    });
  });

  it("preserves a selected JSON format for earlier argument errors", () => {
    expect(parseRunArguments(["--unknown", "--report", "json"])).toEqual({
      ok: false,
      error: "Unknown run option: --unknown",
      format: "json",
    });
  });

  it("reports a missing file in JSON mode when only the format is provided", () => {
    expect(parseRunArguments(["--report", "json"])).toEqual({
      ok: false,
      error: "Missing scenario file. Usage: mcp-failure-lab run <file> [--report console|json]",
      format: "json",
    });
  });
});
