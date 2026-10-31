import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const REQUIRED_ROOT_FILES = ["LICENSE", "README.md", "package.json"];
const EXPECTED_BIN = "dist/cli.js";

async function sourceFiles(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(entryPath, root);
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        return [path.relative(root, entryPath).split(path.sep).join("/")];
      }
      return [];
    }),
  );
  return files.flat();
}

export function expectedPackagePaths(sources) {
  const expected = new Set(REQUIRED_ROOT_FILES);
  for (const source of sources) {
    const output = `dist/${source.slice(0, -3)}`;
    expected.add(`${output}.js`);
    expected.add(`${output}.js.map`);
    expected.add(`${output}.d.ts`);
    expected.add(`${output}.d.ts.map`);
  }
  return expected;
}

export function validatePackageContents(packResult, packageJson, sources) {
  if (!Array.isArray(packResult) || packResult.length !== 1) {
    throw new Error("npm pack must return exactly one package");
  }

  const files = packResult[0]?.files;
  if (!Array.isArray(files)) throw new Error("npm pack did not return a file list");

  const expected = expectedPackagePaths(sources);
  const actual = new Map(files.map((file) => [file.path, file]));
  const missing = [...expected].filter((file) => !actual.has(file));
  const unexpected = [...actual.keys()].filter((file) => !expected.has(file));

  if (missing.length > 0)
    throw new Error(`package is missing required files: ${missing.join(", ")}`);
  if (unexpected.length > 0) {
    throw new Error(`package includes unexpected files: ${unexpected.join(", ")}`);
  }

  const bin = packageJson.bin?.["mcp-failure-lab"];
  if (bin !== `./${EXPECTED_BIN}` && bin !== EXPECTED_BIN) {
    throw new Error(`mcp-failure-lab executable must point to ./${EXPECTED_BIN}`);
  }

  const cli = actual.get(EXPECTED_BIN);
  if (typeof cli?.mode !== "number" || (cli.mode & 0o111) === 0) {
    throw new Error(`${EXPECTED_BIN} must be executable`);
  }
}

export async function validateCurrentPackage(rootDirectory) {
  const [packageSource, sources, pack] = await Promise.all([
    readFile(path.join(rootDirectory, "package.json"), "utf8"),
    sourceFiles(path.join(rootDirectory, "src")),
    execFileAsync("npm", ["pack", "--dry-run", "--json"], {
      cwd: rootDirectory,
      maxBuffer: 10 * 1024 * 1024,
    }),
  ]);
  validatePackageContents(JSON.parse(pack.stdout), JSON.parse(packageSource), sources);
  console.log(`Validated ${packResultFileCount(pack.stdout)} package files`);
}

function packResultFileCount(stdout) {
  return JSON.parse(stdout)[0].files.length;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  const rootDirectory = path.resolve(path.dirname(scriptPath), "..");
  validateCurrentPackage(rootDirectory).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
