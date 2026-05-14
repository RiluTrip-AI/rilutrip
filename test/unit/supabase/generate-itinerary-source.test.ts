import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const generateItinerarySource = readFileSync(
  join(process.cwd(), "supabase/functions/generate-itinerary/index.ts"),
  "utf8",
);

describe("generate-itinerary source guards", () => {
  it("does not mark generation completed before auto route optimization finishes", () => {
    const tokenWriteIndex = generateItinerarySource.indexOf("internal_optimization_token_hash");
    const optimizeIndex = generateItinerarySource.indexOf("optimizeGeneratedItinerary({");
    const finalizeIndex = generateItinerarySource.indexOf(
      "finalizeGeneratedItinerary(",
      optimizeIndex,
    );

    expect(tokenWriteIndex).toBeGreaterThan(-1);
    expect(optimizeIndex).toBeGreaterThan(-1);
    expect(generateItinerarySource.slice(tokenWriteIndex, optimizeIndex)).not.toContain(
      'status: "completed"',
    );
    expect(finalizeIndex).toBeGreaterThan(optimizeIndex);
  });

  it("cleans the internal optimization token from itinerary data in a finally block", () => {
    const tokenWriteIndex = generateItinerarySource.indexOf("internal_optimization_token_hash");
    const finallyIndex = generateItinerarySource.indexOf("finally", tokenWriteIndex);
    const cleanupIndex = generateItinerarySource.indexOf(
      "finalizeGeneratedItinerary",
      tokenWriteIndex,
    );

    expect(tokenWriteIndex).toBeGreaterThan(-1);
    expect(finallyIndex).toBeGreaterThan(tokenWriteIndex);
    expect(cleanupIndex).toBeGreaterThan(finallyIndex);
  });
});
