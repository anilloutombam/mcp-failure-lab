import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 40,
        functions: 50,
        branches: 25,
        statements: 40,
      },
    },
  },
});
