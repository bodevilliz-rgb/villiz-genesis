import { describe, expect, it } from "vitest";

describe("Quality Gate verification", () => {
  it("fails deliberately so GitHub CI must reject the change", () => {
    expect(true).toBe(false);
  });
});
