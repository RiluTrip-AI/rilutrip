import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const optimizeRouteSource = readFileSync(
  join(process.cwd(), "supabase/functions/optimize-route/index.ts"),
  "utf8",
);

describe("optimize-route source guards", () => {
  it("preserves place_id when falling back to resolve-places for missing coordinates", () => {
    expect(optimizeRouteSource).toMatch(
      /places: batch\.map\(\(activity\) => \(\{[\s\S]*name: activity\.location\.name,[\s\S]*place_id: activity\.location\.place_id/,
    );
  });

  it("loads trusted day matrices before subset validation so delete-only edits can reuse cached rows", () => {
    const functionStart = optimizeRouteSource.indexOf("async function loadTrustedDayMatrix");
    const functionEnd = optimizeRouteSource.indexOf("async function saveTrustedDayMatrix");
    const loadTrustedDayMatrixSource = optimizeRouteSource.slice(functionStart, functionEnd);

    expect(loadTrustedDayMatrixSource).toContain('.eq("day_number", input.dayNumber)');
    expect(loadTrustedDayMatrixSource).toContain('.eq("transport_mode", input.transportMode)');
    expect(loadTrustedDayMatrixSource).not.toContain('.eq("location_fingerprint"');
    expect(optimizeRouteSource).toContain("subsetMatrix(day.precomputedMatrix");
  });
});
