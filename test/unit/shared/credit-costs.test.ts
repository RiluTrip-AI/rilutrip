import { describe, expect, it } from "vitest";
import { CREDIT_COSTS } from "@/shared/credit-costs";

describe("CREDIT_COSTS", () => {
  it("defines an OPTIMIZE_ROUTE cost of 2", () => {
    expect(CREDIT_COSTS.OPTIMIZE_ROUTE).toBe(2);
  });
});
