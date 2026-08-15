import { describe, expect, it, vi } from "vitest";

import { waitForCancellation } from "../../src/hang.js";

describe("waitForCancellation", () => {
  it("remains pending until cancellation", async () => {
    const controller = new AbortController();
    const settled = vi.fn();
    const pending = waitForCancellation(controller.signal).finally(settled);

    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(settled).toHaveBeenCalledOnce();
  });

  it("rejects immediately when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled by test"));

    await expect(waitForCancellation(controller.signal)).rejects.toThrow("cancelled by test");
  });
});
