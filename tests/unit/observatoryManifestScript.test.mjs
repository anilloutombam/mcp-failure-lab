import { describe, expect, it } from "vitest";
import { validateObservatoryManifest } from "../../scripts/validate-observatory-manifest.mjs";

function validManifest() {
  return {
    schemaVersion: 1,
    reports: [
      {
        id: "example-server-1.0.0",
        testedOn: "2026-09-28",
        sourceUrl:
          "https://github.com/anilloutombam/mcp-failure-lab/blob/main/docs/compatibility/example-server-1.0.0.md",
        implementation: {
          name: "Example Server",
          slug: "example-server",
          version: "1.0.0",
          kind: "server",
          repositoryUrl: "https://github.com/example/server",
        },
        outcomes: [
          {
            scenario: ["Baseline Ping", "baseline-ping", "baseline"],
            runs: [["stdio", "stdio", "passed", 2.4, "Baseline ping passed."]],
          },
        ],
        findings: [],
      },
    ],
  };
}

describe("Observatory manifest validation", () => {
  it("accepts a valid normalized report", () => {
    expect(() => validateObservatoryManifest(validManifest())).not.toThrow();
  });

  it("rejects records that are not MCP implementations", () => {
    const manifest = validManifest();
    manifest.reports[0].implementation.kind = "experiment";
    expect(() => validateObservatoryManifest(manifest)).toThrow();
  });

  it("rejects duplicate run aliases", () => {
    const manifest = validManifest();
    manifest.reports[0].outcomes[0].runs.push(manifest.reports[0].outcomes[0].runs[0]);
    expect(() => validateObservatoryManifest(manifest)).toThrow("Duplicate run alias");
  });

  it("rejects findings linked to an unknown run", () => {
    const manifest = validManifest();
    manifest.reports[0].findings.push({
      id: "missing-run",
      run: "baseline-ping:http",
      statement: "The referenced run does not exist.",
      category: "recovery",
      reportingStatus: "reported",
      repository: "example/server",
      issueNumber: 1,
      issueUrl: "https://github.com/example/server/issues/1",
      reportedAt: "2026-09-28T10:00:00Z",
    });
    expect(() => validateObservatoryManifest(manifest)).toThrow("references missing run");
  });
});
