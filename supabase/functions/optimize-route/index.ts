import { corsHeaders } from "../_shared/cors.ts";
import { verifyUser } from "../_shared/auth.ts";
import { parseJsonRequest, unauthorizedResponse } from "../_shared/request-guards.ts";
import { captureCredits, refundCredits } from "../_shared/credits.ts";
import { createSupabaseAdminClient } from "../_shared/supabase.ts";
import {
  coordKey,
  parseOrderedCoords,
  serializeOrderedCoords,
  subsetMatrixByCoords,
} from "./matrix-cache.ts";
import {
  type ActivityInput,
  type Json,
  type MatrixSource,
  type OptimizeDayInput,
  type OptimizedDay,
  type TransportMode,
  isRecord,
} from "./types.ts";
import {
  buildActivityTimeConstraints,
  normalizeOpeningHoursForDate,
  parseTimeToMinutes,
} from "./time-windows.ts";
import { buildDistanceMatrixWithSource } from "./distance-matrix.ts";
import { callVroom, greedyFallback } from "./solver.ts";
import { z } from "npm:zod";
import { type SupabaseClient } from "npm:@supabase/supabase-js@2";

const TimeHHMMSchema = z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/);
const UuidSchema = z.uuid();
const TransportModeSchema = z.enum(["walking", "bicycling", "driving", "transit"]);
const RESOLVE_BATCH_SIZE = 10;
// Optimistic write retries. Each retry re-reads the latest itinerary and
// re-applies the precomputed order; the read+write window is tiny, so a
// concurrent edit almost never beats us more than once.
const MAX_WRITE_RETRIES = 5;
// Cap concurrent per-day optimize calls. Each day already runs chunked Google
// Routes Matrix requests internally, so 3 keeps the total Google fan-out
// bounded while still parallelising across days.
const ROUTE_OPTIMIZE_BATCH_SIZE = 3;

// The request only names which day to optimize. All activity data, day
// settings, and coordinates are read from the stored itinerary (DB is the
// source of truth), never trusted from the client. Exactly one day per request:
// OPTIMIZE_ROUTE is charged once, so allowing many days would let one charge pay
// for many Google matrix / Vroom runs.
const OptimizeRequestSchema = z.object({
  itineraryId: UuidSchema,
  dayNumbers: z.array(z.number().int().positive()).length(1),
  skipCreditCapture: z.boolean().optional(),
  skipCreditCaptureToken: z.string().uuid().optional(),
});

type OptimizeRequest = z.infer<typeof OptimizeRequestSchema>;

// Shape we read out of `itineraries.data` (JSONB). Parsed with Zod (not cast)
// so a malformed row can't crash optimization. Unknown fields are preserved
// only for reading inputs — the write-back path mutates the raw JSON directly
// so nothing is dropped.
const StoredActivitySchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    location: z
      .object({
        name: z.string().optional(),
        place_id: z.string().optional(),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        opening_hours: z.unknown().optional(),
      })
      .optional(),
    duration_minutes: z.number().int().positive().optional(),
    time: z.string().optional(),
    opening_hours: z.object({ open: TimeHHMMSchema, close: TimeHHMMSchema }).optional(),
    type: z.enum(["lunch", "dinner", "breakfast", "transit"]).optional(),
  })
  .passthrough();

const StoredDaySchema = z.object({
  day_number: z.number().int().positive(),
  activities: z.array(StoredActivitySchema).optional(),
  start_time: TimeHHMMSchema.optional(),
  end_time: TimeHHMMSchema.optional(),
  transport_mode: TransportModeSchema.optional(),
});

const StoredItineraryDataSchema = z.object({
  days: z.array(StoredDaySchema).optional(),
});

type StoredDay = z.infer<typeof StoredDaySchema>;

function hasValidGatewaySecret(req: Request): boolean {
  const gatewaySecret = Deno.env.get("API_GATEWAY_SECRET");
  return Boolean(gatewaySecret && req.headers.get("x-gateway-secret") === gatewaySecret);
}

async function hasValidInternalOptimizationToken(
  supabaseAdmin: SupabaseClient,
  request: OptimizeRequest,
): Promise<boolean> {
  if (!request.skipCreditCaptureToken) return false;

  const { data, error } = await supabaseAdmin
    .from("itineraries")
    .select("data")
    .eq("id", request.itineraryId)
    .single();

  if (error || !data || typeof data.data !== "object" || data.data === null) return false;

  const itineraryData = data.data as { internal_optimization_token_hash?: unknown };
  if (typeof itineraryData.internal_optimization_token_hash !== "string") return false;

  return (
    itineraryData.internal_optimization_token_hash ===
    (await sha256Hex(request.skipCreditCaptureToken))
  );
}

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function hasValidCoordinates(location: { lat?: number; lng?: number }): location is {
  lat: number;
  lng: number;
} {
  return (
    typeof location.lat === "number" &&
    Number.isFinite(location.lat) &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    typeof location.lng === "number" &&
    Number.isFinite(location.lng) &&
    location.lng >= -180 &&
    location.lng <= 180
  );
}

async function optimizeDayRoutes(days: OptimizeDayInput[]): Promise<OptimizedDay[]> {
  const results: OptimizedDay[] = [];
  for (let i = 0; i < days.length; i += ROUTE_OPTIMIZE_BATCH_SIZE) {
    const batch = days.slice(i, i + ROUTE_OPTIMIZE_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(optimizeDay));
    results.push(...batchResults);
  }
  return results;
}

async function optimizeDay(day: OptimizeDayInput): Promise<OptimizedDay> {
  const activities = day.activities;
  const startTime = day.startTime;
  const endTime = day.endTime;
  const transportMode = day.transportMode;
  const windowMinutes = parseTimeToMinutes(endTime) - parseTimeToMinutes(startTime);
  const totalDuration = activities.reduce((sum, a) => sum + a.duration_minutes, 0);
  const activityDurationOverloaded = totalDuration >= windowMinutes;
  const dayTimeConstraints = buildActivityTimeConstraints(activities, day.dayNumber);
  const windowTooShortActivityIds = new Set(
    dayTimeConstraints.warnings
      .filter((warning) => warning.code === "ACTIVITY_WINDOW_TOO_SHORT")
      .map((warning) => warning.activityId),
  );

  const buildOriginalResult = (): OptimizedDay => ({
    dayNumber: day.dayNumber,
    activities: activities.map((a, i) => ({ id: a.id, time: a.time, order: i })),
    travelTimesMinutes: [],
    activityDurationOverloaded,
    warnings: dayTimeConstraints.warnings,
  });

  if (activities.length <= 1) return buildOriginalResult();
  const optimizable = activities.filter((a) => hasValidCoordinates(a.location));
  if (optimizable.length < 2) return buildOriginalResult();

  const inputs = optimizable.map((a) => ({
    ...a,
    lat: a.location.lat!,
    lng: a.location.lng!,
  }));
  const routableInputs = inputs.filter((activity) => !windowTooShortActivityIds.has(activity.id));
  if (routableInputs.length < 2) return buildOriginalResult();

  const { timeWindows } = buildActivityTimeConstraints(routableInputs, day.dayNumber);
  const desiredIds = routableInputs.map((i) => i.id);
  const desiredCoords = routableInputs.map((i) => coordKey(i.lat, i.lng));
  const cachedMatrix =
    day.precomputedMatrix && day.precomputedCoords
      ? subsetMatrixByCoords(day.precomputedMatrix, day.precomputedCoords, desiredCoords)
      : null;
  const reusedCache = cachedMatrix !== null;
  const builtMatrix = cachedMatrix
    ? null
    : await buildDistanceMatrixWithSource(routableInputs, transportMode);
  const matrix = cachedMatrix ?? builtMatrix!.matrix;
  const matrixSource = cachedMatrix ? day.precomputedMatrixSource : builtMatrix!.matrixSource;
  if (!matrixSource) return buildOriginalResult();

  const result =
    (await callVroom(
      routableInputs,
      matrix,
      transportMode,
      startTime,
      endTime,
      timeWindows,
      day.dayNumber,
    )) ?? greedyFallback(routableInputs, matrix, parseTimeToMinutes(startTime));

  const timeById = new Map(result.order.map((id, i) => [id, result.startTimes[i]]));
  const orderById = new Map(result.order.map((id, i) => [id, i]));
  let nonOptimizedOffset = 0;
  const allActivities = activities.map((a) => {
    if (timeById.has(a.id)) {
      return { id: a.id, time: timeById.get(a.id)!, order: orderById.get(a.id)! };
    }
    return { id: a.id, time: a.time, order: result.order.length + nonOptimizedOffset++ };
  });

  return {
    dayNumber: day.dayNumber,
    activities: allActivities.sort((a, b) => a.order - b.order),
    travelTimesMinutes: result.travelTimesMinutes,
    activityDurationOverloaded,
    warnings: [...dayTimeConstraints.warnings, ...result.warnings],
    matrixActivityIds: desiredIds,
    matrix,
    transportMode,
    locationFingerprint: serializeOrderedCoords(routableInputs),
    matrixSource,
    reusedCache,
  };
}

async function sha256Hex(payload: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isMatrixSource(value: unknown): value is MatrixSource {
  return value === "google_routes_matrix" || value === "haversine_fallback";
}

async function loadTrustedDayMatrix(
  supabaseAdmin: SupabaseClient,
  input: {
    itineraryId: string;
    dayNumber: number;
    transportMode: TransportMode;
    activities: ActivityInput[];
  },
) {
  const { data, error } = await supabaseAdmin
    .from("day_matrices")
    .select("activity_ids, matrix, transport_mode, location_fingerprint, matrix_source")
    .eq("itinerary_id", input.itineraryId)
    .eq("day_number", input.dayNumber)
    .eq("transport_mode", input.transportMode)
    .maybeSingle();

  if (error || !data || !isMatrixSource(data.matrix_source)) return null;
  return {
    activityIds: data.activity_ids as string[],
    matrix: data.matrix as number[][],
    transportMode: data.transport_mode as TransportMode,
    locationFingerprint: data.location_fingerprint as string,
    matrixSource: data.matrix_source as MatrixSource,
  };
}

async function saveTrustedDayMatrix(
  supabaseAdmin: SupabaseClient,
  input: {
    itineraryId: string;
    dayNumber: number;
    transportMode: TransportMode;
    activityIds: string[];
    locationFingerprint: string;
    matrix: number[][];
    matrixSource: MatrixSource;
  },
): Promise<void> {
  const { error } = await supabaseAdmin.from("day_matrices").upsert(
    {
      itinerary_id: input.itineraryId,
      day_number: input.dayNumber,
      activity_ids: input.activityIds,
      matrix: input.matrix as unknown as Json,
      transport_mode: input.transportMode,
      location_fingerprint: input.locationFingerprint,
      matrix_source: input.matrixSource,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "itinerary_id,day_number" },
  );

  if (error) throw new Error(`Failed to save trusted day matrix: ${error.message}`);
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function storedActivityToInput(activity: z.infer<typeof StoredActivitySchema>): ActivityInput {
  const location = activity.location ?? {};
  return {
    id: activity.id,
    title: activity.title ?? "",
    location: {
      name: location.name ?? "",
      place_id: location.place_id,
      lat: location.lat,
      lng: location.lng,
      opening_hours: location.opening_hours,
    },
    duration_minutes: activity.duration_minutes ?? 60,
    time: activity.time ?? "09:00",
    opening_hours: activity.opening_hours,
    type: activity.type,
  };
}

// Build the optimizer inputs from stored DB days. Coordinates, durations,
// opening hours and the day's own settings all come from the DB; the date is
// derived from the itinerary start date so opening hours normalize correctly.
// Days missing required settings (or with an invalid window) are skipped — the
// client gates on MISSING_SETTINGS, so reaching one here just means "skip".
function buildRequestedDays(
  storedDays: StoredDay[],
  startDate: string,
  dayNumbers: number[],
): OptimizeDayInput[] {
  const byNumber = new Map(storedDays.map((day) => [day.day_number, day]));
  const requested: OptimizeDayInput[] = [];
  for (const dayNumber of dayNumbers) {
    const day = byNumber.get(dayNumber);
    if (!day || !day.transport_mode || !day.start_time || !day.end_time) continue;
    if (day.start_time >= day.end_time) continue;
    requested.push({
      dayNumber,
      date: addDaysToIsoDate(startDate, dayNumber - 1),
      transportMode: day.transport_mode,
      startTime: day.start_time,
      endTime: day.end_time,
      activities: (day.activities ?? []).map(storedActivityToInput),
    });
  }
  return requested;
}

async function loadItineraryForOptimize(
  supabaseAdmin: SupabaseClient,
  itineraryId: string,
): Promise<{
  data: Record<string, unknown>;
  startDate: string;
  updatedAt: string;
  days: StoredDay[];
} | null> {
  const { data, error } = await supabaseAdmin
    .from("itineraries")
    .select("data, start_date, updated_at")
    .eq("id", itineraryId)
    .single();
  if (error || !data) return null;

  const rawData = isRecord(data.data) ? (data.data as Record<string, unknown>) : {};
  const parsedData = StoredItineraryDataSchema.safeParse(rawData);
  return {
    data: rawData,
    startDate: typeof data.start_date === "string" ? data.start_date : "",
    updatedAt: typeof data.updated_at === "string" ? data.updated_at : "",
    days: parsedData.success ? (parsedData.data.days ?? []) : [],
  };
}

function getHydratedMatrixActivityIds(day: OptimizeDayInput): Set<string> {
  return new Set(
    day.activities
      .filter((activity) => hasValidCoordinates(activity.location))
      .map((activity) => activity.id),
  );
}

// How many of a day's activities will actually be routed. Mirrors optimizeDay's
// filter exactly: a valid coordinate is not enough — activities whose own window
// can't fit their duration (ACTIVITY_WINDOW_TOO_SHORT) are dropped before
// routing. Used pre-charge so we never bill OPTIMIZE_ROUTE for a no-op day.
function countRoutableActivities(day: OptimizeDayInput): number {
  const optimizable = day.activities.filter((activity) => hasValidCoordinates(activity.location));
  if (optimizable.length < 2) return optimizable.length;
  const { warnings } = buildActivityTimeConstraints(day.activities, day.dayNumber);
  const windowTooShort = new Set(
    warnings
      .filter((warning) => warning.code === "ACTIVITY_WINDOW_TOO_SHORT")
      .map((warning) => warning.activityId),
  );
  return optimizable.filter((activity) => !windowTooShort.has(activity.id)).length;
}

function hasRoutableDay(days: OptimizeDayInput[]): boolean {
  return days.some((day) => countRoutableActivities(day) >= 2);
}

async function canUserEditItinerary(
  supabaseAdmin: SupabaseClient,
  input: { itineraryId: string; userId: string; email?: string },
): Promise<boolean> {
  const { data: itinerary, error } = await supabaseAdmin
    .from("itineraries")
    .select("user_id, link_access")
    .eq("id", input.itineraryId)
    .single();

  if (error || !itinerary) return false;
  if (itinerary.user_id === input.userId) return true;
  if (itinerary.link_access === "edit") return true;
  if (!input.email) return false;

  const { data: share } = await supabaseAdmin
    .from("itinerary_shares")
    .select("permission")
    .eq("itinerary_id", input.itineraryId)
    .eq("shared_with_email", input.email.toLowerCase())
    .maybeSingle();

  return share?.permission === "edit";
}

function needsCachedPlaceData(activity: ActivityInput): boolean {
  return (
    activity.location.place_id !== undefined &&
    (activity.location.lat === undefined ||
      activity.location.lng === undefined ||
      activity.location.opening_hours === undefined)
  );
}

async function resolveMissingCoordinates(
  activities: ActivityInput[],
  authHeader: string,
): Promise<ActivityInput[]> {
  const missing = activities.filter((activity) => !hasValidCoordinates(activity.location));
  if (missing.length === 0) return activities;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) return activities;

  const resolvedById = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < missing.length; i += RESOLVE_BATCH_SIZE) {
    const batch = missing.slice(i, i + RESOLVE_BATCH_SIZE);
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/resolve-places`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          ...(Deno.env.get("API_GATEWAY_SECRET") && {
            "x-gateway-secret": Deno.env.get("API_GATEWAY_SECRET")!,
          }),
        },
        body: JSON.stringify({
          places: batch.map((activity) => ({
            id: activity.id,
            name: activity.location.name,
            ...(activity.location.place_id !== undefined && {
              place_id: activity.location.place_id,
            }),
            ...(activity.location.lat !== undefined && { lat: activity.location.lat }),
            ...(activity.location.lng !== undefined && { lng: activity.location.lng }),
          })),
        }),
      });
      if (!response.ok) continue;
      const data = (await response.json()) as { resolved?: Array<Record<string, unknown>> };
      data.resolved?.forEach((place) => {
        if (typeof place.id === "string") resolvedById.set(place.id, place);
      });
    } catch {
      continue;
    }
  }

  if (resolvedById.size === 0) return activities;
  return activities.map((activity) => {
    const resolved = resolvedById.get(activity.id);
    if (
      !resolved ||
      resolved.error ||
      !hasValidCoordinates(resolved as { lat?: number; lng?: number })
    ) {
      return activity;
    }
    return {
      ...activity,
      location: {
        ...activity.location,
        ...(typeof resolved.name === "string" && { name: resolved.name }),
        ...(typeof resolved.place_id === "string" && { place_id: resolved.place_id }),
        lat: resolved.lat as number,
        lng: resolved.lng as number,
        ...(resolved.opening_hours !== undefined && { opening_hours: resolved.opening_hours }),
        ...(typeof resolved.rating === "number" && { rating: resolved.rating }),
        ...(typeof resolved.user_ratings_total === "number" && {
          user_ratings_total: resolved.user_ratings_total,
        }),
        ...(typeof resolved.website === "string" && { website: resolved.website }),
      },
    };
  });
}

async function hydrateCachedCoordinates(
  supabaseAdmin: SupabaseClient,
  activities: ActivityInput[],
  authHeader: string,
): Promise<ActivityInput[]> {
  const placeIds = Array.from(
    new Set(
      activities
        .filter(needsCachedPlaceData)
        .map((activity) => activity.location.place_id)
        .filter((placeId): placeId is string => placeId !== undefined),
    ),
  );

  if (placeIds.length === 0) return resolveMissingCoordinates(activities, authHeader);

  const { data, error } = await supabaseAdmin
    .from("google_places")
    .select("place_id, lat, lng, opening_hours")
    .in("place_id", placeIds);

  if (error) return resolveMissingCoordinates(activities, authHeader);
  const coordinatesByPlaceId = new Map(
    data?.map((row) => [
      row.place_id,
      {
        ...(typeof row.lat === "number" && { lat: row.lat }),
        ...(typeof row.lng === "number" && { lng: row.lng }),
        ...(row.opening_hours !== null && { opening_hours: row.opening_hours }),
      },
    ]) ?? [],
  );

  const hydrated = activities.map((activity) => {
    const placeId = activity.location.place_id;
    const coordinates = placeId ? coordinatesByPlaceId.get(placeId) : undefined;
    return coordinates && needsCachedPlaceData(activity)
      ? { ...activity, location: { ...activity.location, ...coordinates } }
      : activity;
  });
  return resolveMissingCoordinates(hydrated, authHeader);
}

async function hydrateCachedCoordinatesForOptimizeRoute(
  supabaseAdmin: SupabaseClient,
  days: OptimizeDayInput[],
  authHeader: string,
): Promise<OptimizeDayInput[]> {
  return Promise.all(
    days.map(async (day) => {
      const activities = await hydrateCachedCoordinates(supabaseAdmin, day.activities, authHeader);
      return {
        ...day,
        activities: activities.map((activity) => ({
          ...activity,
          opening_hours:
            activity.opening_hours ??
            normalizeOpeningHoursForDate(activity.location.opening_hours, day.date),
        })),
      };
    }),
  );
}

async function attachTrustedMatrices(
  supabaseAdmin: SupabaseClient,
  input: { itineraryId: string; days: OptimizeDayInput[] },
): Promise<OptimizeDayInput[]> {
  return Promise.all(
    input.days.map(async (day) => {
      const matrixActivities = day.activities.filter((activity) =>
        hasValidCoordinates(activity.location),
      );
      const cached =
        matrixActivities.length >= 2
          ? await loadTrustedDayMatrix(supabaseAdmin, {
              itineraryId: input.itineraryId,
              dayNumber: day.dayNumber,
              transportMode: day.transportMode,
              activities: matrixActivities,
            })
          : null;

      return {
        ...day,
        ...(cached && {
          precomputedMatrix: cached.matrix,
          precomputedCoords: parseOrderedCoords(cached.locationFingerprint),
          precomputedMatrixSource: cached.matrixSource,
        }),
      };
    }),
  );
}

async function saveReturnedMatrices(
  supabaseAdmin: SupabaseClient,
  input: { itineraryId: string; days: OptimizeDayInput[]; results: OptimizedDay[] },
): Promise<void> {
  await Promise.all(
    input.results.map(async (result) => {
      if (!("matrixActivityIds" in result) || result.matrixActivityIds.length === 0) {
        return;
      }
      // Reused (cache-hit) results are never written back: keep the existing,
      // possibly larger, cached matrix so deletions/reorders stay reusable.
      if (result.reusedCache) return;
      // Never cache straight-line (Haversine) fallbacks. Caching one would make
      // a transient Google outage permanently stick the day on degraded
      // estimates (a later cache hit skips the rebuild, so Google is never
      // retried). Compute-and-discard instead; the next optimize rebuilds and
      // re-attempts Google.
      if (result.matrixSource === "haversine_fallback") return;
      const day = input.days.find((candidate) => candidate.dayNumber === result.dayNumber);
      if (!day) return;
      const hydratedActivityIds = getHydratedMatrixActivityIds(day);
      if (!result.matrixActivityIds.every((id) => hydratedActivityIds.has(id))) return;

      // Order activities to match the matrix rows (matrixActivityIds order) so
      // the stored coordinate string lines up element-by-element with the matrix.
      const byId = new Map(day.activities.map((activity) => [activity.id, activity]));
      const orderedActivities: typeof day.activities = [];
      for (const id of result.matrixActivityIds) {
        const activity = byId.get(id);
        if (!activity) return;
        orderedActivities.push(activity);
      }
      const locationFingerprint = serializeOrderedCoords(
        orderedActivities.map((activity) => ({
          lat: activity.location.lat,
          lng: activity.location.lng,
        })),
      );

      await saveTrustedDayMatrix(supabaseAdmin, {
        itineraryId: input.itineraryId,
        dayNumber: result.dayNumber,
        transportMode: result.transportMode,
        activityIds: result.matrixActivityIds,
        locationFingerprint,
        matrix: result.matrix,
        matrixSource: result.matrixSource,
      }).catch((err) => console.error("Failed to save trusted day matrix:", err));
    }),
  );
}

// Build the full optimized version of each optimized day from the T0 SNAPSHOT
// (the data we optimized against). The optimization "owns" the day: we take the
// snapshot day's own activities, apply the optimized order/time, and keep all
// other snapshot fields. Operates on RAW JSON so note/url/coordinates survive.
// Concurrent edits to this day during optimization are intentionally discarded
// by writing this snapshot-derived day wholesale.
function buildOptimizedDays(
  snapshotData: Record<string, unknown>,
  resultByDay: Map<number, OptimizedDay>,
): Map<number, Record<string, unknown>> {
  const optimizedByDay = new Map<number, Record<string, unknown>>();
  const rawDays = Array.isArray(snapshotData.days) ? snapshotData.days : [];
  for (const rawDay of rawDays) {
    if (!isRecord(rawDay) || typeof rawDay.day_number !== "number") continue;
    const result = resultByDay.get(rawDay.day_number);
    if (!result) continue;
    const orderById = new Map(result.activities.map((activity) => [activity.id, activity]));
    const rawActivities = Array.isArray(rawDay.activities) ? rawDay.activities : [];
    const activities = rawActivities
      .map((rawActivity) => {
        if (!isRecord(rawActivity) || typeof rawActivity.id !== "string") return rawActivity;
        const optimized = orderById.get(rawActivity.id);
        return optimized
          ? { ...rawActivity, time: optimized.time, order: optimized.order }
          : rawActivity;
      })
      .sort((a, b) => {
        const aOrder = isRecord(a) && typeof a.order === "number" ? a.order : 0;
        const bOrder = isRecord(b) && typeof b.order === "number" ? b.order : 0;
        return aOrder - bOrder;
      });
    optimizedByDay.set(rawDay.day_number, { ...rawDay, activities });
  }
  return optimizedByDay;
}

// Persist the result with an optimistic retry loop. Design: the optimized day is
// OWNED by the optimization — we overwrite it wholesale from the T0 snapshot, so
// any edit made to THAT day while Google/Vroom ran is intentionally discarded.
// Every OTHER day is taken from a fresh re-read each attempt, so concurrent edits
// to other days are preserved; the updated_at guard + retry keeps those safe
// (the retry window is just read+write, no API calls, so it almost never repeats).
async function writeOptimizedOrder(
  supabaseAdmin: SupabaseClient,
  input: { itineraryId: string; snapshotData: Record<string, unknown>; results: OptimizedDay[] },
): Promise<boolean> {
  const resultByDay = new Map(input.results.map((result) => [result.dayNumber, result]));
  const optimizedByDay = buildOptimizedDays(input.snapshotData, resultByDay);

  for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
    const current = await loadItineraryForOptimize(supabaseAdmin, input.itineraryId);
    if (!current) return false;

    const freshRawDays = Array.isArray(current.data.days) ? current.data.days : [];
    const newDays = freshRawDays.map((rawDay) => {
      if (!isRecord(rawDay) || typeof rawDay.day_number !== "number") return rawDay;
      // Optimized day → overwrite wholesale from snapshot; other days → keep fresh.
      return optimizedByDay.get(rawDay.day_number) ?? rawDay;
    });

    const { data, error } = await supabaseAdmin
      .from("itineraries")
      .update({ data: { ...current.data, days: newDays } })
      .eq("id", input.itineraryId)
      .eq("updated_at", current.updatedAt)
      .select("id");
    if (error) throw new Error(`Failed to write optimized order: ${error.message}`);
    if ((data?.length ?? 0) > 0) return true;
    // Optimistic-lock miss: re-read the latest (for other days) and re-apply.
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, 405);

  const authHeader = req.headers.get("Authorization");
  const user = await verifyUser(req);
  if (!user || !authHeader) return unauthorizedResponse();

  const parsed = await parseJsonRequest(req, OptimizeRequestSchema);
  if (parsed instanceof Response) return parsed;

  const operationId = crypto.randomUUID();
  const supabaseAdmin = createSupabaseAdminClient();
  const canEdit = await canUserEditItinerary(supabaseAdmin, {
    itineraryId: parsed.data.itineraryId,
    userId: user.userId,
    email: user.email,
  });
  if (!canEdit) return jsonResponse({ error: "Forbidden", code: "FORBIDDEN" }, 403);

  // DB is the source of truth: load the stored itinerary and build the optimizer
  // inputs from it (coords, durations, opening hours, day settings, and a date
  // derived from start_date) rather than trusting anything in the request body.
  const itinerary = await loadItineraryForOptimize(supabaseAdmin, parsed.data.itineraryId);
  if (!itinerary) {
    return jsonResponse({ error: "Itinerary not found", code: "NOT_FOUND" }, 404);
  }
  const requestedDays = buildRequestedDays(
    itinerary.days,
    itinerary.startDate,
    parsed.data.dayNumbers,
  );
  const days = await hydrateCachedCoordinatesForOptimizeRoute(
    supabaseAdmin,
    requestedDays,
    authHeader,
  );
  // Gate (and charge) only when at least one day can actually be optimized.
  // Routable means >= 2 activities with valid coords that also fit their own
  // window — otherwise optimizeDay returns the original order and charging the
  // user would bill them for a no-op.
  if (!hasRoutableDay(days)) {
    return jsonResponse(
      { error: "No day has enough routable activities to optimize", code: "NOT_OPTIMIZABLE" },
      400,
    );
  }

  const skipCreditCapture =
    parsed.data.skipCreditCapture === true &&
    (hasValidGatewaySecret(req) ||
      (await hasValidInternalOptimizationToken(supabaseAdmin, parsed.data)));
  if (!skipCreditCapture) {
    const capture = await captureCredits(supabaseAdmin, user.userId, "OPTIMIZE_ROUTE");
    if (!capture.success) {
      if (capture.error) {
        console.error(
          JSON.stringify({
            action: "OPTIMIZE_ROUTE",
            error: capture.error,
            event: "credit_event",
            operation_id: operationId,
            phase: "capture_failed",
            user_id: user.userId,
          }),
        );
        return jsonResponse({ error: "Credit system error", code: "CREDIT_SYSTEM_ERROR" }, 500);
      }
      return jsonResponse({ error: "Insufficient credits", code: "INSUFFICIENT_CREDITS" }, 402);
    }
  }

  try {
    const daysWithTrustedMatrices = await attachTrustedMatrices(supabaseAdmin, {
      itineraryId: parsed.data.itineraryId,
      days,
    });
    const results = await optimizeDayRoutes(daysWithTrustedMatrices);
    await saveReturnedMatrices(supabaseAdmin, {
      itineraryId: parsed.data.itineraryId,
      days,
      results,
    });

    const written = await writeOptimizedOrder(supabaseAdmin, {
      itineraryId: parsed.data.itineraryId,
      snapshotData: itinerary.data,
      results,
    });
    if (!written) {
      // Lost the optimistic race on every retry (or the itinerary vanished).
      // Other-day edits keep bumping updated_at; refund and ask the client to retry.
      if (!skipCreditCapture) {
        await refundCredits(supabaseAdmin, user.userId, "OPTIMIZE_ROUTE").catch(() => {});
      }
      return jsonResponse(
        { error: "Itinerary changed during optimization", code: "CONFLICT" },
        409,
      );
    }

    // Count activities the solver could not place within the day (window too
    // short, or unassigned by route constraints) so the client can warn once.
    const unfitCount = results.reduce((sum, result) => sum + result.warnings.length, 0);
    return jsonResponse({ ok: true, creditCaptured: !skipCreditCapture, unfitCount });
  } catch (err) {
    console.error(
      JSON.stringify({
        action: "OPTIMIZE_ROUTE",
        error: err instanceof Error ? err.message : String(err),
        event: "optimize_error",
        operation_id: operationId,
        phase: "optimization_failed",
        user_id: user.userId,
      }),
    );
    if (!skipCreditCapture) {
      const refund = await refundCredits(supabaseAdmin, user.userId, "OPTIMIZE_ROUTE");
      if (!refund.success) {
        console.error(
          JSON.stringify({
            action: "OPTIMIZE_ROUTE",
            error: refund.error ?? "refund failed",
            event: "credit_event",
            operation_id: operationId,
            phase: "refund_failed",
            user_id: user.userId,
          }),
        );
      }
    }
    return jsonResponse({ error: "Optimization failed" }, 500);
  }
});
