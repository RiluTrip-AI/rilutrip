// Travel-time distance matrix for the optimize-route edge function: Google
// Routes Matrix API with a straight-line (Haversine) fallback.

import { type TransportMode, type MatrixSource } from "./types.ts";

type RoutesTravelMode = "DRIVE" | "BICYCLE" | "WALK" | "TRANSIT";

interface RoutesMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  condition?: string;
  duration?: string;
  status?: unknown;
}

const GOOGLE_MATRIX_CHUNK_SIZE = 10;
const ROUTES_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const ROUTES_MATRIX_FIELD_MASK = "originIndex,destinationIndex,duration,condition,status";
const EARTH_RADIUS_KM = 6371;
const MAX_FETCH_RETRIES = 3;

const MODE_SPEED_KMH: Record<TransportMode, number> = {
  walking: 4.0,
  bicycling: 15.0,
  driving: 40.0,
  transit: 20.0,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch wrapper that retries on HTTP 429 with exponential backoff, so a Google
 * API quota burst doesn't silently downgrade us to Haversine. This is a retry
 * on the outbound Google call — not a per-user rate limiter.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_FETCH_RETRIES,
): Promise<Response> {
  const resp = await fetch(url, options);
  if (resp.status !== 429) return resp;
  if (retries === 0) return resp;
  const backoff = Math.pow(2, MAX_FETCH_RETRIES - retries) * 1000;
  await delay(backoff);
  return fetchWithRetry(url, options, retries - 1);
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

  const matrix = points.map(() => points.map(() => 0));
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
        const res = await fetchWithRetry(ROUTES_MATRIX_URL, {
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

          // Cells Google can't route (condition !== ROUTE_EXISTS) fall back to a
          // straight-line estimate. Notably this is every TRANSIT cell in Japan:
          // Google's Routes/Directions API returns no transit there (licensing
          // with Japanese operators), so JP transit days are always estimated —
          // verified against the live API (Taiwan/US/UK transit return real times).
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

export async function buildDistanceMatrixWithSource(
  points: Array<{ lat: number; lng: number }>,
  mode: TransportMode,
): Promise<{ matrix: number[][]; matrixSource: MatrixSource }> {
  const google = await buildGoogleMatrix(points, mode);
  if (google) return { matrix: google, matrixSource: "google_routes_matrix" };

  const fallbackMode: TransportMode = mode === "transit" ? "driving" : mode;
  return { matrix: buildHaversineMatrix(points, fallbackMode), matrixSource: "haversine_fallback" };
}
