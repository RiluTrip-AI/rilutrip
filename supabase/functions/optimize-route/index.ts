import { corsHeaders } from "../_shared/cors.ts";
import { verifyUser } from "../_shared/auth.ts";
import { parseJsonRequest, unauthorizedResponse } from "../_shared/request-guards.ts";
import { captureCredits, refundCredits } from "../_shared/credits.ts";
import { createSupabaseAdminClient } from "../_shared/supabase.ts";
import { z } from "npm:zod";
import { type SupabaseClient } from "npm:@supabase/supabase-js@2";

type TransportMode = "walking" | "bicycling" | "driving" | "transit";
type MatrixSource = "google_routes_matrix" | "google_distance_matrix" | "haversine_fallback";
type RoutesTravelMode = "DRIVE" | "BICYCLE" | "WALK" | "TRANSIT";
type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

interface ActivityInput {
  id: string;
  title: string;
  location: {
    name: string;
    place_id?: string;
    lat?: number;
    lng?: number;
    opening_hours?: unknown;
  };
  duration_minutes: number;
  time: string;
  opening_hours?: { open: string; close: string };
  type?: "lunch" | "dinner" | "breakfast" | "transit";
}

interface OptimizeDayInput {
  dayNumber: number;
  date?: string;
  transportMode: TransportMode;
  startTime: string;
  endTime: string;
  activities: ActivityInput[];
  precomputedMatrix?: number[][];
  matrixActivityIds?: string[];
  precomputedMatrixSource?: MatrixSource;
}

interface OptimizedActivity {
  id: string;
  time: string;
  order: number;
}

type ActivityWindowTooShortWarning = {
  code: "ACTIVITY_WINDOW_TOO_SHORT";
  dayNumber: number;
  activityId: string;
  title: string;
  openingHours: { open: string; close: string };
  durationMinutes: number;
  availableMinutes: number;
};

type ActivityUnassignedWarning = {
  code: "ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS";
  dayNumber: number;
  activityId: string;
  title: string;
  durationMinutes: number;
  reason: "DAY_END" | "ROUTE_CONSTRAINTS";
  dayEndTime: string;
};

type OptimizeWarning = ActivityWindowTooShortWarning | ActivityUnassignedWarning;

interface OptimizedDayBase {
  dayNumber: number;
  activities: OptimizedActivity[];
  travelTimesMinutes: number[];
  activityDurationOverloaded: boolean;
  warnings: OptimizeWarning[];
}

type OptimizedDay =
  | OptimizedDayBase
  | (OptimizedDayBase & {
      matrixActivityIds: string[];
      matrix: number[][];
      transportMode: TransportMode;
      locationFingerprint: string;
      matrixSource: MatrixSource;
    });

interface OptimizeResult {
  order: string[];
  travelTimesMinutes: number[];
  startTimes: string[];
  warnings: OptimizeWarning[];
}

interface RoutesMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  condition?: string;
  duration?: string;
  status?: unknown;
}

const TimeHHMMSchema = z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/);
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const UuidSchema = z.uuid();
const TransportModeSchema = z.enum(["walking", "bicycling", "driving", "transit"]);
const MAX_DAYS_PER_REQUEST = 14;
const MAX_ACTIVITIES_PER_DAY = 30;
const GOOGLE_MATRIX_CHUNK_SIZE = 10;
const ROUTES_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const ROUTES_MATRIX_FIELD_MASK = "originIndex,destinationIndex,duration,condition,status";
const EARTH_RADIUS_KM = 6371;
const ORS_URL = "https://api.openrouteservice.org/optimization";
const RESOLVE_BATCH_SIZE = 10;
const MAX_FETCH_RETRIES = 3;
// Cap concurrent per-day optimize calls. Each day already runs chunked Google
// Routes Matrix requests internally, so 3 keeps the total Google fan-out
// bounded while still parallelising across days.
const ROUTE_OPTIMIZE_BATCH_SIZE = 3;

const MODE_SPEED_KMH: Record<TransportMode, number> = {
  walking: 4.0,
  bicycling: 15.0,
  driving: 40.0,
  transit: 20.0,
};

const MEAL_WINDOWS: Record<string, { open: string; close: string }> = {
  breakfast: { open: "07:00", close: "10:00" },
  lunch: { open: "11:00", close: "14:00" },
  dinner: { open: "17:30", close: "21:00" },
};

const ActivityInputSchema = z.object({
  id: z.string(),
  title: z.string(),
  location: z.object({
    name: z.string(),
    place_id: z.string().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    opening_hours: z.unknown().optional(),
  }),
  duration_minutes: z.number().int().positive(),
  time: z.string(),
  opening_hours: z.object({ open: TimeHHMMSchema, close: TimeHHMMSchema }).optional(),
  type: z.enum(["lunch", "dinner", "breakfast", "transit"]).optional(),
});

const DayInputSchema = z
  .object({
    dayNumber: z.number().int().positive(),
    date: DateSchema.optional(),
    transportMode: TransportModeSchema,
    startTime: TimeHHMMSchema,
    endTime: TimeHHMMSchema,
    activities: z.array(ActivityInputSchema).max(MAX_ACTIVITIES_PER_DAY),
  })
  .superRefine((day, ctx) => {
    if (day.startTime >= day.endTime) {
      ctx.addIssue({
        code: "custom",
        message: "endTime must be after startTime",
        path: ["endTime"],
      });
    }
  });

const OptimizeRequestSchema = z.object({
  itineraryId: UuidSchema,
  days: z.array(DayInputSchema).min(1).max(MAX_DAYS_PER_REQUEST),
  skipCreditCapture: z.boolean().optional(),
  skipCreditCaptureToken: z.string().uuid().optional(),
});

type OptimizeRequest = z.infer<typeof OptimizeRequestSchema>;

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

function parseTimeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function formatTime(mins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, mins));
  const h = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const m = (clamped % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function parseTimeToSeconds(hhmm: string): number {
  return parseTimeToMinutes(hhmm) * 60;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch wrapper that retries on 429 with exponential backoff. Mirrors the
 * pattern in `_shared/place-resolver.ts` so Google API quota bursts don't
 * silently downgrade us to Haversine.
 */
async function rateLimitedFetch(
  url: string,
  options: RequestInit,
  retries = MAX_FETCH_RETRIES,
): Promise<Response> {
  const resp = await fetch(url, options);
  if (resp.status !== 429) return resp;
  if (retries === 0) return resp;
  const backoff = Math.pow(2, MAX_FETCH_RETRIES - retries) * 1000;
  await delay(backoff);
  return rateLimitedFetch(url, options, retries - 1);
}

function resolveCloseSeconds(hhmm: string, openSec: number): number {
  const sec = parseTimeToSeconds(hhmm);
  return sec === 0 || sec < openSec ? 86400 : sec;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildHaversineMatrix(points: Array<{ lat: number; lng: number }>, mode: TransportMode) {
  const speed = MODE_SPEED_KMH[mode];
  return points.map((a, i) =>
    points.map((b, j) => {
      if (i === j) return 0;
      const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
      return Math.max(1, Math.round((km / speed) * 60));
    }),
  );
}

function estimateTravelMinutes(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: TransportMode,
): number {
  const km = haversineKm(from.lat, from.lng, to.lat, to.lng);
  return Math.max(1, Math.round((km / MODE_SPEED_KMH[mode]) * 60));
}

function chunkPoints<T>(points: T[], size: number): Array<{ start: number; points: T[] }> {
  const chunks: Array<{ start: number; points: T[] }> = [];
  for (let start = 0; start < points.length; start += size) {
    chunks.push({ start, points: points.slice(start, start + size) });
  }
  return chunks;
}

function toRoutesTravelMode(mode: TransportMode): RoutesTravelMode {
  switch (mode) {
    case "walking":
      return "WALK";
    case "bicycling":
      return "BICYCLE";
    case "transit":
      return "TRANSIT";
    case "driving":
    default:
      return "DRIVE";
  }
}

function toRoutesWaypoint(point: { lat: number; lng: number }) {
  return {
    waypoint: {
      location: {
        latLng: {
          latitude: point.lat,
          longitude: point.lng,
        },
      },
    },
  };
}

function parseRoutesDurationMinutes(duration: unknown): number | null {
  if (typeof duration !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(duration);
  if (!match) return null;

  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds)) return null;
  return Math.max(1, Math.round(seconds / 60));
}

async function buildGoogleMatrix(
  points: Array<{ lat: number; lng: number }>,
  mode: TransportMode,
): Promise<number[][] | null> {
  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey) return null;

  const matrix = points.map((_, i) => points.map((__, j) => (i === j ? 0 : 0)));
  const originChunks = chunkPoints(points, GOOGLE_MATRIX_CHUNK_SIZE);
  const destinationChunks = chunkPoints(points, GOOGLE_MATRIX_CHUNK_SIZE);
  const travelMode = toRoutesTravelMode(mode);

  try {
    for (const origins of originChunks) {
      for (const destinations of destinationChunks) {
        const body = {
          origins: origins.points.map(toRoutesWaypoint),
          destinations: destinations.points.map(toRoutesWaypoint),
          travelMode,
          ...(travelMode === "DRIVE" && { routingPreference: "TRAFFIC_UNAWARE" }),
        };
        const res = await rateLimitedFetch(ROUTES_MATRIX_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": ROUTES_MATRIX_FIELD_MASK,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!Array.isArray(data)) return null;

        const seen = new Set<string>();
        for (const element of data as RoutesMatrixElement[]) {
          const originIndex = element.originIndex;
          const destinationIndex = element.destinationIndex;
          if (
            typeof originIndex !== "number" ||
            typeof destinationIndex !== "number" ||
            originIndex < 0 ||
            destinationIndex < 0 ||
            originIndex >= origins.points.length ||
            destinationIndex >= destinations.points.length
          ) {
            return null;
          }

          const i = origins.start + originIndex;
          const j = destinations.start + destinationIndex;
          seen.add(`${originIndex}:${destinationIndex}`);
          if (i === j) {
            matrix[i][j] = 0;
            continue;
          }

          const minutes = parseRoutesDurationMinutes(element.duration);
          matrix[i][j] =
            element.condition === "ROUTE_EXISTS" && minutes !== null
              ? minutes
              : estimateTravelMinutes(points[i], points[j], mode);
        }

        for (let originIndex = 0; originIndex < origins.points.length; originIndex++) {
          for (
            let destinationIndex = 0;
            destinationIndex < destinations.points.length;
            destinationIndex++
          ) {
            if (seen.has(`${originIndex}:${destinationIndex}`)) continue;
            const i = origins.start + originIndex;
            const j = destinations.start + destinationIndex;
            matrix[i][j] = i === j ? 0 : estimateTravelMinutes(points[i], points[j], mode);
          }
        }
      }
    }
    return matrix;
  } catch {
    return null;
  }
}

async function buildDistanceMatrixWithSource(
  points: Array<{ lat: number; lng: number }>,
  mode: TransportMode,
): Promise<{ matrix: number[][]; matrixSource: MatrixSource }> {
  const google = await buildGoogleMatrix(points, mode);
  if (google) return { matrix: google, matrixSource: "google_routes_matrix" };

  const fallbackMode: TransportMode = mode === "transit" ? "driving" : mode;
  return { matrix: buildHaversineMatrix(points, fallbackMode), matrixSource: "haversine_fallback" };
}

function subsetMatrix(
  matrix: number[][],
  cachedIds: string[],
  desiredIds: string[],
): number[][] | null {
  const indexMap = new Map(cachedIds.map((id, i) => [id, i]));
  const indices: number[] = [];
  for (const id of desiredIds) {
    const i = indexMap.get(id);
    if (i === undefined) return null;
    indices.push(i);
  }
  return indices.map((row) => indices.map((col) => matrix[row][col]));
}

function getWindowOpenMinutes(act: ActivityInput): number | null {
  const mealWindow = act.type ? MEAL_WINDOWS[act.type] : undefined;
  const mealOpen = mealWindow ? parseTimeToMinutes(mealWindow.open) : null;
  const placeOpen = act.opening_hours ? parseTimeToMinutes(act.opening_hours.open) : null;
  return mealOpen !== null && placeOpen !== null
    ? Math.max(mealOpen, placeOpen)
    : (mealOpen ?? placeOpen);
}

function getWindowCloseMinutes(act: ActivityInput): number | null {
  const mealWindow = act.type ? MEAL_WINDOWS[act.type] : undefined;
  const mealClose = mealWindow ? parseTimeToMinutes(mealWindow.close) : null;
  if (!act.opening_hours) return mealClose;

  const placeOpen = parseTimeToMinutes(act.opening_hours.open);
  const rawPlaceClose = parseTimeToMinutes(act.opening_hours.close);
  const placeClose = rawPlaceClose === 0 || rawPlaceClose < placeOpen ? 24 * 60 : rawPlaceClose;
  return mealClose !== null ? Math.min(mealClose, placeClose) : placeClose;
}

function greedyFallback(
  activities: ActivityInput[],
  matrix: number[][],
  startTimeMinutes: number,
): OptimizeResult {
  const n = activities.length;
  const hasWindows = activities.some((a) => a.opening_hours || (a.type && MEAL_WINDOWS[a.type]));

  let start = 0;
  if (hasWindows) {
    let earliest = Infinity;
    activities.forEach((a, i) => {
      const open = getWindowOpenMinutes(a) ?? 9999;
      if (open < earliest) {
        earliest = open;
        start = i;
      }
    });
  }

  const unvisited = new Set(Array.from({ length: n }, (_, i) => i));
  let current = start;
  unvisited.delete(start);
  const route = [start];
  let currentTime = startTimeMinutes;

  while (unvisited.size > 0) {
    let nextNode = -1;
    if (hasWindows) {
      let bestScore: [number, number] = [3, Infinity];
      for (const j of unvisited) {
        const travel = matrix[current][j];
        const arrive = currentTime + activities[current].duration_minutes + travel;
        const open = getWindowOpenMinutes(activities[j]);
        const close = getWindowCloseMinutes(activities[j]);
        let score: [number, number];

        if (close !== null && arrive > close) {
          score = [2, travel];
        } else if (open !== null) {
          score = [0, Math.max(0, open - arrive) + travel];
        } else {
          score = [1, travel];
        }

        if (score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
          bestScore = score;
          nextNode = j;
        }
      }
      const travel = matrix[current][nextNode];
      const arrive = currentTime + activities[current].duration_minutes + travel;
      const open = getWindowOpenMinutes(activities[nextNode]);
      currentTime = Math.max(arrive, open ?? arrive);
    } else {
      let minTravel = Infinity;
      for (const j of unvisited) {
        if (matrix[current][j] < minTravel) {
          minTravel = matrix[current][j];
          nextNode = j;
        }
      }
      currentTime += activities[current].duration_minutes + matrix[current][nextNode];
    }
    route.push(nextNode);
    unvisited.delete(nextNode);
    current = nextNode;
  }

  const order = route.map((i) => activities[i].id);
  const travelTimes = route.slice(0, -1).map((from, k) => Math.max(1, matrix[from][route[k + 1]]));
  const startTimes: string[] = [];
  let t = startTimeMinutes;
  for (let k = 0; k < route.length; k++) {
    const act = activities[route[k]];
    const open = getWindowOpenMinutes(act);
    t = Math.max(t, open ?? t);
    startTimes.push(formatTime(t));
    t += act.duration_minutes + (k < travelTimes.length ? travelTimes[k] : 0);
  }

  return { order, travelTimesMinutes: travelTimes, startTimes, warnings: [] };
}

function secondsToHHMM(seconds: number): string {
  return formatTime(Math.floor(seconds / 60));
}

function buildTimeWindow(
  act: ActivityInput,
  dayNumber: number,
): { timeWindow: [number, number] | null; warning: OptimizeWarning | null } {
  let openSec: number | null = null;
  let closeSec: number | null = null;
  let openingHours: { open: string; close: string } | null = null;

  if (act.type && MEAL_WINDOWS[act.type]) {
    const window = MEAL_WINDOWS[act.type];
    openSec = parseTimeToSeconds(window.open);
    closeSec = parseTimeToSeconds(window.close);
    if (act.opening_hours) {
      openSec = Math.max(openSec, parseTimeToSeconds(act.opening_hours.open));
      closeSec = Math.min(closeSec, resolveCloseSeconds(act.opening_hours.close, openSec));
      if (openSec > closeSec) {
        openSec = parseTimeToSeconds(window.open);
        closeSec = parseTimeToSeconds(window.close);
      }
    }
    openingHours = { open: secondsToHHMM(openSec), close: secondsToHHMM(closeSec) };
  }

  if (!openingHours && act.opening_hours) {
    openSec = parseTimeToSeconds(act.opening_hours.open);
    closeSec = resolveCloseSeconds(act.opening_hours.close, openSec);
    openingHours = act.opening_hours;
  }

  if (openSec === null || closeSec === null || !openingHours) {
    return { timeWindow: null, warning: null };
  }

  const latestStartSec = closeSec - act.duration_minutes * 60;
  if (latestStartSec < openSec) {
    const availableMinutes = Math.max(0, Math.floor((closeSec - openSec) / 60));
    return {
      timeWindow: null,
      warning: {
        code: "ACTIVITY_WINDOW_TOO_SHORT",
        dayNumber,
        activityId: act.id,
        title: act.title,
        openingHours,
        durationMinutes: act.duration_minutes,
        availableMinutes,
      },
    };
  }

  return { timeWindow: [openSec, latestStartSec], warning: null };
}

function buildActivityTimeConstraints(activities: ActivityInput[], dayNumber: number) {
  const constraints = activities.map((act) => buildTimeWindow(act, dayNumber));
  return {
    timeWindows: constraints.map((constraint) => constraint.timeWindow),
    warnings: constraints.flatMap((constraint) => (constraint.warning ? [constraint.warning] : [])),
  };
}

function buildUnassignedWarnings(
  activities: ActivityInput[],
  dayNumber: number,
  endTime: string,
  unassigned: unknown,
): ActivityUnassignedWarning[] {
  if (!Array.isArray(unassigned)) return [];

  const warnings: ActivityUnassignedWarning[] = [];
  for (const entry of unassigned) {
    if (!isRecord(entry) || typeof entry.id !== "number") continue;
    const activity = activities[entry.id - 1];
    if (!activity) continue;
    const hasActivityWindow = activity.opening_hours !== undefined || Boolean(activity.type);
    warnings.push({
      code: "ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS",
      dayNumber,
      activityId: activity.id,
      title: activity.title,
      durationMinutes: activity.duration_minutes,
      reason: hasActivityWindow ? "ROUTE_CONSTRAINTS" : "DAY_END",
      dayEndTime: endTime,
    });
  }
  return warnings;
}

async function callVroom(
  activities: ActivityInput[],
  minuteMatrix: number[][],
  _mode: TransportMode,
  startTime: string,
  endTime: string,
  timeWindows: Array<[number, number] | null>,
  dayNumber: number,
): Promise<OptimizeResult | null> {
  const apiKey = Deno.env.get("ORS_API_KEY");
  if (!apiKey) return null;

  const secondsMatrix = minuteMatrix.map((row) => row.map((v) => v * 60));
  const jobs = activities.map((act, i) => {
    const job: Record<string, unknown> = {
      id: i + 1,
      location_index: i,
      service: act.duration_minutes * 60,
    };
    const timeWindow = timeWindows[i];
    if (timeWindow) job.time_windows = [timeWindow];
    return job;
  });

  try {
    const res = await fetch(ORS_URL, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        jobs,
        vehicles: [
          {
            id: 1,
            profile: "driving-car",
            start_index: 0,
            time_window: [parseTimeToSeconds(startTime), parseTimeToSeconds(endTime)],
          },
        ],
        matrices: { "driving-car": { durations: secondsMatrix } },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const routes = data.routes ?? [];
    if (!routes.length) return null;

    type VroomStep = {
      id: number;
      arrival: number;
      service: number;
      waiting_time: number;
      type: string;
    };
    const steps: VroomStep[] = routes[0].steps.filter((s: VroomStep) => s.type === "job");
    const unassignedWarnings = buildUnassignedWarnings(
      activities,
      dayNumber,
      endTime,
      data.unassigned,
    );
    if (steps.length === 0 && unassignedWarnings.length === 0) return null;

    const order = steps.map((s) => activities[s.id - 1].id);
    const travelTimes = steps.slice(0, -1).map((s, k) => {
      const travelSec = steps[k + 1].arrival - s.arrival - s.waiting_time - s.service;
      return Math.max(1, Math.round(travelSec / 60));
    });
    const startTimes = steps.map((s) => formatTime(Math.round((s.arrival + s.waiting_time) / 60)));
    return { order, travelTimesMinutes: travelTimes, startTimes, warnings: unassignedWarnings };
  } catch {
    return null;
  }
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
  const cachedMatrix =
    day.precomputedMatrix && day.matrixActivityIds
      ? subsetMatrix(day.precomputedMatrix, day.matrixActivityIds, desiredIds)
      : null;
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
    locationFingerprint: await calculateLocationFingerprint(routableInputs),
    matrixSource,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeCoordinate(value: number | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(6) : null;
}

async function sha256Hex(payload: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function calculateLocationFingerprint(activities: ActivityInput[]): Promise<string> {
  const payload = activities
    .map((activity) => ({
      id: activity.id,
      place_id: activity.location.place_id ?? null,
      lat: normalizeCoordinate(activity.location.lat),
      lng: normalizeCoordinate(activity.location.lng),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return sha256Hex(JSON.stringify(payload));
}

function isMatrixSource(value: unknown): value is MatrixSource {
  return (
    value === "google_routes_matrix" ||
    value === "google_distance_matrix" ||
    value === "haversine_fallback"
  );
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
    activities: ActivityInput[];
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
      location_fingerprint: await calculateLocationFingerprint(input.activities),
      matrix_source: input.matrixSource,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "itinerary_id,day_number" },
  );

  if (error) throw new Error(`Failed to save trusted day matrix: ${error.message}`);
}

function getHydratedMatrixActivityIds(day: OptimizeRequest["days"][number]): Set<string> {
  return new Set(
    day.activities
      .filter((activity) => hasValidCoordinates(activity.location))
      .map((activity) => activity.id),
  );
}

function hasOptimizableDay(days: OptimizeRequest["days"]): boolean {
  return days.some(
    (day) =>
      day.activities.filter((activity) => hasValidCoordinates(activity.location)).length >= 2,
  );
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

function getLocalWeekday(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getDay();
}

function toMinutes(
  point: { day?: number; hour?: number; minute?: number } | undefined,
): number | null {
  if (!point || typeof point.hour !== "number") return null;
  const minute = typeof point.minute === "number" ? point.minute : 0;
  if (point.hour < 0 || point.hour > 23 || minute < 0 || minute > 59) return null;
  return point.hour * 60 + minute;
}

function formatMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, minutes));
  if (clamped === 24 * 60) return "00:00";
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function normalizeOpeningHoursForDate(raw: unknown, date?: string) {
  if (isRecord(raw) && typeof raw.open === "string" && typeof raw.close === "string") {
    return { open: raw.open, close: raw.close };
  }
  if (!date || !isRecord(raw) || !Array.isArray(raw.periods)) return undefined;

  const weekday = getLocalWeekday(date);
  if (weekday === null) return undefined;
  const sameDayWindows: Array<{ open: number; close: number }> = [];
  const overnightWindows: Array<{ open: number; close: number }> = [];

  for (const rawPeriod of raw.periods) {
    if (!isRecord(rawPeriod)) continue;
    const open = isRecord(rawPeriod.open) ? rawPeriod.open : undefined;
    const close = isRecord(rawPeriod.close) ? rawPeriod.close : undefined;

    if (open?.day === weekday) {
      const openMinutes = toMinutes(open);
      const closeMinutes = toMinutes(close);
      if (openMinutes === null) continue;
      if (!close || close.day !== weekday || closeMinutes === null || closeMinutes <= openMinutes) {
        sameDayWindows.push({ open: openMinutes, close: 24 * 60 });
      } else {
        sameDayWindows.push({ open: openMinutes, close: closeMinutes });
      }
    }

    const previousWeekday = (weekday + 6) % 7;
    if (open?.day === previousWeekday && close?.day === weekday) {
      const closeMinutes = toMinutes(close);
      if (closeMinutes !== null && closeMinutes > 0) {
        overnightWindows.push({ open: 0, close: closeMinutes });
      }
    }
  }

  const windows = [...overnightWindows, ...sameDayWindows];
  if (windows.length === 0) return undefined;
  return {
    open: formatMinutes(Math.min(...windows.map((window) => window.open))),
    close: formatMinutes(Math.max(...windows.map((window) => window.close))),
  };
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
  days: OptimizeRequest["days"],
  authHeader: string,
): Promise<OptimizeRequest["days"]> {
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
  input: { itineraryId: string; days: OptimizeRequest["days"] },
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
          matrixActivityIds: cached.activityIds,
          precomputedMatrixSource: cached.matrixSource,
        }),
      };
    }),
  );
}

async function saveReturnedMatrices(
  supabaseAdmin: SupabaseClient,
  input: { itineraryId: string; days: OptimizeRequest["days"]; results: OptimizedDay[] },
): Promise<void> {
  await Promise.all(
    input.results.map(async (result) => {
      if (!("matrixActivityIds" in result) || result.matrixActivityIds.length === 0) {
        return;
      }
      const day = input.days.find((candidate) => candidate.dayNumber === result.dayNumber);
      if (!day) return;
      const hydratedActivityIds = getHydratedMatrixActivityIds(day);
      if (!result.matrixActivityIds.every((id) => hydratedActivityIds.has(id))) return;

      const matrixActivities = day.activities.filter((activity) =>
        result.matrixActivityIds.includes(activity.id),
      );
      if (matrixActivities.length !== result.matrixActivityIds.length) return;

      await saveTrustedDayMatrix(supabaseAdmin, {
        itineraryId: input.itineraryId,
        dayNumber: result.dayNumber,
        transportMode: result.transportMode,
        activityIds: result.matrixActivityIds,
        activities: matrixActivities,
        matrix: result.matrix,
        matrixSource: result.matrixSource,
      }).catch((err) => console.error("Failed to save trusted day matrix:", err));
    }),
  );
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

  const days = await hydrateCachedCoordinatesForOptimizeRoute(
    supabaseAdmin,
    parsed.data.days,
    authHeader,
  );
  if (!hasOptimizableDay(days)) {
    return jsonResponse(
      { error: "Not enough geocoded activities to optimize", code: "NOT_OPTIMIZABLE" },
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
    const warnings = results.flatMap((result) => result.warnings);
    return jsonResponse({ days: results, warnings, creditCaptured: !skipCreditCapture });
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
