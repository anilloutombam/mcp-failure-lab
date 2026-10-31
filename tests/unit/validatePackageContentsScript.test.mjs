import { describe, expect, it } from "vitest";

import {
  expectedPackagePaths,
  validatePackageContents,
} from "../../scripts/validate-package-contents.mjs";

const sources = ["cli.ts", "nested/helper.ts"];
const packageJson = { bin: { "mcp-failure-lab": "./dist/cli.js" } };

function packFiles() {
  return [...expectedPackagePaths(sources)].map((file) => ({
    path: file,
    mode: file === "dist/cli.js" ? 0o755 : 0o644,
  }));
}

function packResult(files = packFiles()) {
  return [{ files }];
}

describe("npm package-content validation", () => {
  it("accepts the expected compiled package", () => {
    expect(() => validatePackageContents(packResult(), packageJson, sources)).not.toThrow();
  });

  it("rejects a missing required file", () => {
    const files = packFiles().filter((file) => file.path !== "README.md");
    expect(() => validatePackageContents(packResult(files), packageJson, sources)).toThrow(
      "package is missing required files: README.md",
    );
  });

  it("rejects an unexpected file", () => {
    const files = [...packFiles(), { path: "secrets.txt", mode: 0o644 }];
    expect(() => validatePackageContents(packResult(files), packageJson, sources)).toThrow(
      "package includes unexpected files: secrets.txt",
    );
  });

  it("rejects an incorrect executable target", () => {
    expect(() =>
      validatePackageContents(
        packResult(),
        { bin: { "mcp-failure-lab": "./dist/server.js" } },
        sources,
      ),
    ).toThrow("mcp-failure-lab executable must point to ./dist/cli.js");
  });

  it("rejects a CLI without an executable mode", () => {
    const files = packFiles().map((file) =>
      file.path === "dist/cli.js" ? { ...file, mode: 0o644 } : file,
    );
    expect(() => validatePackageContents(packResult(files), packageJson, sources)).toThrow(
      "dist/cli.js must be executable",
    );
  });
});
