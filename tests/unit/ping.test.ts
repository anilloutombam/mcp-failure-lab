import { describe, expect, it } from "vitest";

import type { Clock } from "../../src/ping.js";
import { createPingResult } from "../../src/ping.js";

describe("createPingResult", () => {
  it("returns a healthy status with the clock timestamp", () => {
    const fixedClock: Clock = {
      now: () => new Date("2026-07-31T12:00:00.000Z"),
    };

    const result = createPingResult(fixedClock);

    expect(result).toEqual({
      status: "ok",
      timestamp: "2026-07-31T12:00:00.000Z",
    });
  });
});
