import { describe, expect, it, vi } from "vitest";

import { runDemoCommand } from "../../src/demoCommand.js";

describe("demo command", () => {
  it("runs the built-in delay scenario successfully", async () => {
    const output = {
      write: vi.fn(),
      writeError: vi.fn(),
    };

    await expect(runDemoCommand(output)).resolves.toBe(0);

    expect(output.writeError).not.toHaveBeenCalled();

    expect(output.write).toHaveBeenCalledWith("MCP Failure Lab — Demo");

    expect(output.write).toHaveBeenCalledWith("Running a real 500ms delay scenario...");

    expect(output.write).toHaveBeenCalledWith(
      expect.stringContaining("Scenario: Deterministic delay demo"),
    );

    expect(output.write).toHaveBeenCalledWith(expect.stringContaining("Outcome: success"));

    expect(output.write).toHaveBeenCalledWith(expect.stringContaining("Assertions: passed"));
  });
});
