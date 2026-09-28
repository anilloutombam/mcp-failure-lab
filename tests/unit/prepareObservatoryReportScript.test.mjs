import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendObservatoryReport,
  prepareObservatoryReport,
} from "../../scripts/prepare-observatory-report.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "observatory-authoring-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "docs/compatibility"), { recursive: true });
  await writeFile(join(directory, "docs/compatibility/example.md"), "# Example\n");
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify({
      name: "Baseline Ping",
      outcome: "success",
      durationMs: 12.5,
      passed: true,
      failures: [],
    }),
  );
  return directory;
}

function plan() {
  return {
    report: {
      id: "example-server-1.0.0",
      testedOn: "2026-09-28",
      sourcePath: "docs/compatibility/example.md",
    },
    implementation: {
      name: "Example Server",
      slug: "example-server",
      version: "1.0.0",
      kind: "server",
      repositoryUrl: "https://github.com/example/server",
    },
    runs: [
      {
        resultFile: "result.json",
        alias: "stdio",
        transport: "stdio",
        scenarioSlug: "baseline-ping",
        category: "baseline",
      },
    ],
  };
}

describe("Observatory report preparation", () => {
  it("converts a scenario result into a normalized draft report", async () => {
    const directory = await fixture();
    const prepared = await prepareObservatoryReport(plan(), {
      planDirectory: directory,
      repositoryRoot: directory,
    });

    expect(prepared).toMatchObject({
      id: "example-server-1.0.0",
      implementation: { slug: "example-server" },
      outcomes: [
        {
          scenario: ["Baseline Ping", "baseline-ping", "baseline"],
          runs: [
            [
              "stdio",
              "stdio",
              "passed",
              12.5,
              "Baseline Ping matched its configured expectation (success).",
            ],
          ],
        },
      ],
      findings: [],
    });
  });

  it("rejects duplicate report identities before writing", async () => {
    const directory = await fixture();
    const manifestPath = join(directory, "manifest.json");
    const prepared = await prepareObservatoryReport(plan(), {
      planDirectory: directory,
      repositoryRoot: directory,
    });
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, reports: [prepared] }));

    await expect(appendObservatoryReport(prepared, manifestPath)).rejects.toThrow(
      "Report already exists: example-server-1.0.0",
    );
  });
});
