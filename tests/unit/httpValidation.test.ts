import { describe, expect, it } from "vitest";

import { isCanonicalHttpPath, isWildcardHost } from "../../src/httpValidation.js";

describe("HTTP validation", () => {
  it("treats a malformed host as non-wildcard", () => {
    expect(isWildcardHost("%")).toBe(false);
  });

  it("rejects a malformed endpoint path", () => {
    expect(isCanonicalHttpPath("%")).toBe(false);
  });
});
