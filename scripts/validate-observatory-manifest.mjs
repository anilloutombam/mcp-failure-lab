import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const transportSchema = z.enum(["stdio", "streamable-http"]);
const statusSchema = z.enum(["passed", "failed", "needs-review"]);
const categorySchema = z.enum([
  "baseline",
  "timing",
  "transport",
  "protocol",
  "lifecycle",
  "other",
]);
const findingCategorySchema = z.enum([
  "compatibility",
  "recovery",
  "protocol-behavior",
  "transport",
  "reliability",
  "other",
]);
const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const stableIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
const httpsUrlSchema = z.url().refine((value) => value.startsWith("https://"), {
  message: "Use an HTTPS URL.",
});

const runSchema = z.tuple([
  stableIdSchema,
  transportSchema,
  statusSchema,
  z.number().nonnegative().nullable(),
  z.string().min(1),
]);

const findingSchema = z
  .object({
    id: stableIdSchema,
    run: z.string().min(3),
    statement: z.string().min(1),
    category: findingCategorySchema,
    reportingStatus: z.enum(["reported", "already-reported"]),
    repository: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
    issueNumber: z.number().int().positive(),
    issueUrl: httpsUrlSchema,
    commentUrl: httpsUrlSchema.optional(),
    reportedAt: z.iso.datetime(),
  })
  .strict();

const reportSchema = z
  .object({
    id: stableIdSchema,
    testedOn: z.iso.date(),
    sourceUrl: httpsUrlSchema,
    implementation: z
      .object({
        name: z.string().min(1),
        slug: slugSchema,
        version: z.string().min(1),
        kind: z.enum(["client", "server", "proxy"]),
        repositoryUrl: httpsUrlSchema,
      })
      .strict(),
    outcomes: z
      .array(
        z
          .object({
            scenario: z.tuple([z.string().min(1), slugSchema, categorySchema]),
            runs: z.array(runSchema).min(1),
          })
          .strict(),
      )
      .min(1),
    findings: z.array(findingSchema).optional(),
  })
  .strict();

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    reports: z.array(reportSchema).min(1),
  })
  .strict();

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

export function validateObservatoryManifest(input) {
  const manifest = manifestSchema.parse(input);
  assertUnique(
    manifest.reports.map((report) => report.id),
    "report id",
  );

  const allSourceKeys = [];
  for (const report of manifest.reports) {
    if (
      !report.sourceUrl.startsWith(
        "https://github.com/anilloutombam/mcp-failure-lab/blob/main/docs/compatibility/",
      )
    ) {
      throw new Error(`Unexpected report source URL: ${report.sourceUrl}`);
    }

    const runAliases = [];
    for (const outcome of report.outcomes) {
      const scenarioSlug = outcome.scenario[1];
      for (const run of outcome.runs) {
        const alias = `${scenarioSlug}:${run[0]}`;
        runAliases.push(alias);
        allSourceKeys.push(`mcp-failure-lab:${report.id}:${alias}`);
      }
    }
    assertUnique(runAliases, `run alias in ${report.id}`);

    const findingIds = (report.findings ?? []).map((finding) => finding.id);
    assertUnique(findingIds, `finding id in ${report.id}`);
    const availableRuns = new Set(runAliases);
    for (const finding of report.findings ?? []) {
      if (!availableRuns.has(finding.run)) {
        throw new Error(`Finding ${report.id}:${finding.id} references missing run ${finding.run}`);
      }
    }
  }

  assertUnique(allSourceKeys, "Test Run source key");
  return manifest;
}

export function summarizeObservatoryManifest(manifest) {
  return manifest.reports.reduce(
    (summary, report) => {
      summary.runs += report.outcomes.reduce((total, outcome) => total + outcome.runs.length, 0);
      summary.findings += report.findings?.length ?? 0;
      return summary;
    },
    { reports: manifest.reports.length, runs: 0, findings: 0 },
  );
}

async function validateSourceFiles(manifest, repositoryRoot) {
  for (const report of manifest.reports) {
    const relativePath = new URL(report.sourceUrl).pathname.split("/blob/main/")[1];
    if (!relativePath?.startsWith("docs/compatibility/")) {
      throw new Error(`Invalid source path for ${report.id}`);
    }
    await access(new URL(relativePath, repositoryRoot));
  }
}

async function main() {
  const repositoryRoot = new URL("../", import.meta.url);
  const manifestUrl = new URL("data/observatory/compatibility-reports.json", repositoryRoot);
  const manifest = validateObservatoryManifest(JSON.parse(await readFile(manifestUrl, "utf8")));
  await validateSourceFiles(manifest, repositoryRoot);

  console.log(
    JSON.stringify(
      {
        manifest: fileURLToPath(manifestUrl),
        schemaVersion: manifest.schemaVersion,
        ...summarizeObservatoryManifest(manifest),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Validation failed.");
    process.exit(1);
  });
}
