import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { validateObservatoryManifest } from "./validate-observatory-manifest.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const defaultManifestPath = resolve(repositoryRoot, "data/observatory/compatibility-reports.json");

const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const stableIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);

const authoringPlanSchema = z
  .object({
    report: z
      .object({
        id: stableIdSchema,
        testedOn: z.iso.date(),
        sourcePath: z
          .string()
          .regex(/^docs\/compatibility\/[^/]+\.md$/)
          .refine((value) => value !== "docs/compatibility/README.md", {
            message: "Use a compatibility report, not the directory README.",
          }),
      })
      .strict(),
    implementation: z
      .object({
        name: z.string().min(1),
        slug: slugSchema,
        version: z.string().min(1),
        kind: z.enum(["client", "server", "proxy"]),
        repositoryUrl: z
          .url()
          .refine(
            (value) => value.startsWith("https://github.com/"),
            "Use the implementation's HTTPS GitHub repository URL.",
          ),
      })
      .strict(),
    runs: z
      .array(
        z
          .object({
            resultFile: z.string().min(1),
            alias: stableIdSchema,
            transport: z.enum(["stdio", "streamable-http"]),
            scenarioSlug: slugSchema,
            category: z.enum(["baseline", "timing", "transport", "protocol", "lifecycle", "other"]),
            scenarioName: z.string().min(1).optional(),
            status: z.enum(["passed", "failed", "needs-review"]).optional(),
            observation: z.string().min(1).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const scenarioResultSchema = z
  .object({
    name: z.string().min(1),
    outcome: z.enum(["success", "error", "timeout"]),
    durationMs: z.number().nonnegative(),
    passed: z.boolean(),
    failures: z.array(z.string()),
    error: z.string().optional(),
  })
  .passthrough();

function sourceUrl(sourcePath) {
  return `https://github.com/anilloutombam/mcp-failure-lab/blob/main/${sourcePath}`;
}

function generatedObservation(result) {
  if (result.passed) {
    return `${result.name} matched its configured expectation (${result.outcome}).`;
  }

  const detail = result.failures.length > 0 ? result.failures.join("; ") : result.error;
  return detail
    ? `${result.name} did not match its configured expectation: ${detail}`
    : `${result.name} did not match its configured expectation (${result.outcome}).`;
}

async function assertRegularFile(path, label) {
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isFile()) throw new Error(`${label} is not a file: ${path}`);
}

export async function prepareObservatoryReport(planInput, options = {}) {
  const plan = authoringPlanSchema.parse(planInput);
  const planDirectory = options.planDirectory ?? repositoryRoot;
  const sourceRoot = options.repositoryRoot ?? repositoryRoot;
  const reportPath = resolve(sourceRoot, plan.report.sourcePath);
  await assertRegularFile(reportPath, "Compatibility report");

  const outcomes = new Map();
  const aliases = new Set();

  for (const run of plan.runs) {
    const resultPath = resolve(planDirectory, run.resultFile);
    await assertRegularFile(resultPath, "Scenario result");
    const result = scenarioResultSchema.parse(JSON.parse(await readFile(resultPath, "utf8")));
    const scenarioName = run.scenarioName ?? result.name;
    const existing = outcomes.get(run.scenarioSlug);

    if (existing && (existing.name !== scenarioName || existing.category !== run.category)) {
      throw new Error(
        `Scenario ${run.scenarioSlug} uses inconsistent names or categories in the authoring plan.`,
      );
    }

    const sourceAlias = `${run.scenarioSlug}:${run.alias}`;
    if (aliases.has(sourceAlias)) throw new Error(`Duplicate run alias: ${sourceAlias}`);
    aliases.add(sourceAlias);

    const outcome = existing ?? {
      name: scenarioName,
      category: run.category,
      runs: [],
    };
    outcome.runs.push([
      run.alias,
      run.transport,
      run.status ?? (result.passed ? "passed" : "failed"),
      Number.isFinite(result.durationMs) ? result.durationMs : null,
      run.observation ?? generatedObservation(result),
    ]);
    outcomes.set(run.scenarioSlug, outcome);
  }

  return {
    id: plan.report.id,
    testedOn: plan.report.testedOn,
    sourceUrl: sourceUrl(plan.report.sourcePath),
    implementation: plan.implementation,
    outcomes: [...outcomes.entries()].map(([slug, outcome]) => ({
      scenario: [outcome.name, slug, outcome.category],
      runs: outcome.runs,
    })),
    findings: [],
  };
}

export async function appendObservatoryReport(report, manifestPath = defaultManifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.reports?.some((existing) => existing.id === report.id)) {
    throw new Error(`Report already exists: ${report.id}`);
  }

  const nextManifest = validateObservatoryManifest({
    ...manifest,
    reports: [...manifest.reports, report],
  });
  await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
  return nextManifest;
}

function usage() {
  return [
    "Usage: npm run observatory:prepare -- --input <authoring-plan.json> [--write]",
    "",
    "Preview is the default. Pass --write to append the validated report to the manifest.",
  ].join("\n");
}

function parseArguments(arguments_) {
  let input;
  let write = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--input") input = arguments_[++index];
    else if (argument === "--write") write = true;
    else if (argument === "--help" || argument === "-h") return { help: true };
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!input) throw new Error("Missing required --input path.");
  return { input, write, help: false };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const inputPath = resolve(process.cwd(), options.input);
  const plan = JSON.parse(await readFile(inputPath, "utf8"));
  const report = await prepareObservatoryReport(plan, { planDirectory: dirname(inputPath) });

  if (options.write) {
    await appendObservatoryReport(report);
    console.log(`Added ${report.id} to data/observatory/compatibility-reports.json`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Report preparation failed.");
    console.error(`\n${usage()}`);
    process.exit(1);
  });
}
