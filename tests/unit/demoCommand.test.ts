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

  it("returns 2 when the demo scenario assertions fail", async () => {
    const output = {
      write: vi.fn(),
      writeError: vi.fn(),
    };

    const execute = vi.fn().mockResolvedValue({
      name: "Deterministic delay demo",
      outcome: "success",
      durationMs: 2_500,
      passed: false,
      failures: ["expected duration at most 2000ms, received 2500ms"],
    });

    await expect(runDemoCommand(output, execute)).resolves.toBe(2);

    expect(execute).toHaveBeenCalledOnce();

    expect(output.write).toHaveBeenCalledWith(expect.stringContaining("Assertions: failed"));

    expect(output.writeError).not.toHaveBeenCalled();
  });

  it("returns 1 when demo execution fails", async () => {
    const output = {
      write: vi.fn(),
      writeError: vi.fn(),
    };

    const execute = vi.fn().mockRejectedValue(new Error("test failure"));

    await expect(runDemoCommand(output, execute)).resolves.toBe(1);

    expect(execute).toHaveBeenCalledOnce();

    expect(output.writeError).toHaveBeenCalledWith("Demo failed: test failure");
  });
});
