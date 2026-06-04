import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = "supabase/functions/optimize-route";
const read = (file: string) => readFileSync(join(process.cwd(), dir, file), "utf8");
const source = read("index.ts");

describe("optimize-route edge function source", () => {
  it("does not reference the removed google_distance_matrix source", () => {
    expect(source).not.toContain("google_distance_matrix");
  });

  it("still supports the Routes Matrix and Haversine sources", () => {
    expect(source).toContain("google_routes_matrix");
    expect(source).toContain("haversine_fallback");
  });

  it("does not write Haversine fallback matrices back to the cache", () => {
    expect(source).toContain('if (result.matrixSource === "haversine_fallback") return;');
  });

  it("gates the request on a routable day before charging (no charge for no-ops)", () => {
    expect(source).toContain("if (!hasRoutableDay(days))");
    // The routable gate must run before the credit capture.
    expect(source.indexOf("!hasRoutableDay(days)")).toBeLessThan(
      source.indexOf('captureCredits(supabaseAdmin, user.userId, "OPTIMIZE_ROUTE")'),
    );
  });

  it("captures and refunds OPTIMIZE_ROUTE credits", () => {
    expect(source).toContain('captureCredits(supabaseAdmin, user.userId, "OPTIMIZE_ROUTE")');
    expect(source).toContain('refundCredits(supabaseAdmin, user.userId, "OPTIMIZE_ROUTE")');
  });

  it("loads the itinerary from the DB instead of trusting client route data", () => {
    expect(source).toContain("loadItineraryForOptimize(supabaseAdmin, parsed.data.itineraryId)");
    expect(source).toContain("buildRequestedDays(");
    // Request carries only day numbers, never activities/coordinates.
    expect(source).toContain("dayNumbers");
    expect(source).not.toContain("parsed.data.days");
  });

  it("derives each day's date from the itinerary start date", () => {
    expect(source).toContain("addDaysToIsoDate(startDate, dayNumber - 1)");
  });

  it("returns the optimized order to the client instead of writing it back", () => {
    // The server is read-only on the itinerary: it computes and returns the
    // optimized days, and the client applies them via commitItineraryChange
    // (DB write + Yjs broadcast + undo). No itinerary write-back here.
    expect(source).toContain("days: buildClientDays(results)");
    expect(source).not.toContain("writeOptimizedOrder");
    expect(source).not.toContain('.eq("updated_at"');
    expect(source).not.toContain('code: "CONFLICT"');
  });

  it("drops the unused skip-credit bypass machinery", () => {
    expect(source).not.toContain("skipCreditCapture");
    expect(source).not.toContain("internal_optimization_token_hash");
    expect(source).not.toContain("hasValidGatewaySecret");
  });

  it("accepts exactly one day per request so a single charge can't pay for many", () => {
    expect(source).toContain("dayNumbers: z.array(z.number().int().positive()).length(1)");
  });
});

describe("optimize-route module structure", () => {
  it("keeps the distance-matrix engine in distance-matrix.ts", () => {
    const matrix = read("distance-matrix.ts");
    expect(matrix).toContain("export async function buildDistanceMatrixWithSource");
    expect(matrix).toContain("computeRouteMatrix"); // Google Routes Matrix endpoint
    expect(source).toContain('from "./distance-matrix.ts"');
  });

  it("keeps the TSP solvers (Vroom + greedy) in solver.ts", () => {
    const solver = read("solver.ts");
    expect(solver).toContain("export async function callVroom");
    expect(solver).toContain("export function greedyFallback");
    expect(source).toContain('from "./solver.ts"');
  });

  it("keeps time-window logic in time-windows.ts", () => {
    const tw = read("time-windows.ts");
    expect(tw).toContain("export function buildActivityTimeConstraints");
    expect(tw).toContain("export function normalizeOpeningHoursForDate");
    expect(source).toContain('from "./time-windows.ts"');
  });

  it("keeps shared types in types.ts", () => {
    expect(source).toContain('from "./types.ts"');
  });
});
