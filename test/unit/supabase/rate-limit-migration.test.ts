import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("api rate limit migration", () => {
  it("restricts rate-limit RPC execution to service_role", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260504000002_api_rate_limit_bans.sql"),
      "utf8",
    ).toLowerCase();

    expect(sql).toMatch(
      /revoke execute on function public\.increment_and_check_rate_limit\([^)]*\)\s+from public/,
    );
    expect(sql).toContain("from anon");
    expect(sql).toContain("from authenticated");
    expect(sql).toContain("grant execute on function public.increment_and_check_rate_limit");
    expect(sql).toContain("to service_role");
  });
});

describe("rate-limit operational alerts", () => {
  it("emits rate-limit RPC failures as critical alert events", () => {
    const source = readFileSync(
      join(process.cwd(), "supabase/functions/_shared/rate-limit.ts"),
      "utf8",
    );

    expect(source).toContain('event: "rate_limit_error"');
    expect(source).toContain('severity: "critical"');
    expect(source).toContain("fail_open: true");
  });
});

describe("day matrices migration", () => {
  it("keeps cached day matrix writes server-owned", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260428000001_day_matrices.sql"),
      "utf8",
    ).toLowerCase();

    expect(sql).toContain("location_fingerprint text not null");
    expect(sql).toContain("matrix_source text not null");
    expect(sql).not.toContain("for insert");
    expect(sql).not.toContain("for update");
  });

  it("allows shared viewers to read cached day matrices", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260428000001_day_matrices.sql"),
      "utf8",
    ).toLowerCase();

    expect(sql).toContain("for select");
    expect(sql).toContain("link_access in ('view', 'edit')");
  });
});

describe("optimize-route request contract", () => {
  it("requires day time window and transport mode instead of falling back to defaults", () => {
    const source = readFileSync(
      join(process.cwd(), "supabase/functions/optimize-route/index.ts"),
      "utf8",
    );

    expect(source).toContain("transportMode: TransportModeSchema,");
    expect(source).toContain("startTime: TimeHHMMSchema,");
    expect(source).toContain("endTime: TimeHHMMSchema,");
    expect(source).not.toContain("day.transportMode ?? DEFAULT_TRIP_SETTINGS.transportMode");
    expect(source).not.toContain("day.startTime ?? DEFAULT_TRIP_SETTINGS.startTime");
    expect(source).not.toContain("day.endTime ?? DEFAULT_TRIP_SETTINGS.endTime");
  });

  it("keeps the first optimized activity aligned to the requested day start", () => {
    const source = readFileSync(
      join(process.cwd(), "supabase/functions/optimize-route/index.ts"),
      "utf8",
    );

    expect(source).not.toContain("[startTime, ...result.startTimes.slice(1)]");
    expect(source).toContain("result.order.map((id, i) => [id, result.startTimes[i]])");
  });

  it("allows credit-free route optimization only for internal generation calls", () => {
    const source = readFileSync(
      join(process.cwd(), "supabase/functions/optimize-route/index.ts"),
      "utf8",
    );

    expect(source).toContain("skipCreditCapture: z.boolean().optional()");
    expect(source).toContain("hasValidGatewaySecret(req)");
    expect(source).toContain("hasValidInternalOptimizationToken");
    expect(source).toContain("skipCreditCaptureToken: z.string().uuid().optional()");
    expect(source).toContain("internal_optimization_token_hash");
    expect(source).toContain("creditCaptured: !skipCreditCapture");
    expect(source).toContain('req.headers.get("x-gateway-secret")');
    expect(source).toContain('Deno.env.get("API_GATEWAY_SECRET")');
  });

  it("treats opening hours as a latest-start hard constraint", () => {
    const source = readFileSync(
      join(process.cwd(), "supabase/functions/optimize-route/index.ts"),
      "utf8",
    );

    expect(source).toContain("ACTIVITY_WINDOW_TOO_SHORT");
    expect(source).toContain("latestStartSec");
    expect(source).toContain("closeSec - act.duration_minutes * 60");
    expect(source).toContain("availableMinutes");
    expect(source).toContain("warnings");
  });

  it("keeps partial ORS routes and reports route-level unassigned activities", () => {
    const source = readFileSync(
      join(process.cwd(), "supabase/functions/optimize-route/index.ts"),
      "utf8",
    );

    expect(source).toContain("ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS");
    expect(source).toContain("windowTooShortActivityIds");
    expect(source).toContain("routableInputs");
    expect(source).toContain("buildUnassignedWarnings");
    expect(source).not.toContain("steps.length < activities.length && data.unassigned?.length");
  });

  it("saves returned matrices against the hydrated request day instead of stale itinerary data", () => {
    const source = readFileSync(
      join(process.cwd(), "supabase/functions/optimize-route/index.ts"),
      "utf8",
    );

    expect(source).toContain("getHydratedMatrixActivityIds");
    expect(source).toContain("result.matrixActivityIds.every((id) => hydratedActivityIds.has(id))");
    expect(source).not.toContain("loadPersistedMatrixActivityIds");
  });

  it("lets ORS handle overloaded days instead of forcing greedy fallback", () => {
    const source = readFileSync(
      join(process.cwd(), "supabase/functions/optimize-route/index.ts"),
      "utf8",
    );

    expect(source).toContain("activityDurationOverloaded");
    expect(source).toContain("await callVroom(");
    expect(source).not.toContain("activityDurationOverloaded\n    ? greedyFallback");
  });
});

describe("generate-itinerary route optimization", () => {
  it("runs internal route optimization after persisting generated days", () => {
    const source = readFileSync(
      join(process.cwd(), "supabase/functions/generate-itinerary/index.ts"),
      "utf8",
    );

    expect(source).toContain("optimizeGeneratedItinerary");
    expect(source).toContain("skipCreditCapture: true");
    expect(source).toContain("skipCreditCaptureToken");
    expect(source).toContain("internal_optimization_token_hash");
    expect(source).toContain("sha256Hex(skipCreditCaptureToken)");
    expect(source).toContain('"x-gateway-secret": gatewaySecret');
    expect(source).toContain("fetch(`${supabaseUrl}/functions/v1/optimize-route`");
    expect(source).toContain("mergeOptimizedDays");
    expect(source).toContain("optimization_warnings: optimized.warnings ?? []");
    expect(source).toContain("startTime: day.start_time");
    expect(source).toContain("endTime: day.end_time");
  });
});

describe("public itinerary RPC migration", () => {
  it("returns settings from public itinerary RPC functions", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260506051815_include_settings_in_public_itinerary_rpc.sql",
      ),
      "utf8",
    ).toLowerCase();

    expect(sql).toContain("drop function if exists public.get_public_itinerary(uuid)");
    expect(sql).toContain("drop function if exists public.update_public_itinerary(uuid, jsonb)");
    expect(sql).toContain("settings jsonb");
    expect(sql).toContain("i.settings");
    expect(sql).toContain("settings = coalesce(p_updates->'settings', i.settings)");
  });
});
