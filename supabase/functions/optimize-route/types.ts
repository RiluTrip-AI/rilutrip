// Shared types for the optimize-route edge function and its helper modules.

export type TransportMode = "walking" | "bicycling" | "driving" | "transit";
export type MatrixSource = "google_routes_matrix" | "haversine_fallback";
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface ActivityInput {
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

export interface OptimizeDayInput {
  dayNumber: number;
  date?: string;
  transportMode: TransportMode;
  startTime: string;
  endTime: string;
  activities: ActivityInput[];
  precomputedMatrix?: number[][];
  precomputedCoords?: string[];
  precomputedMatrixSource?: MatrixSource;
}

export interface OptimizedActivity {
  id: string;
  time: string;
  order: number;
}

export type ActivityWindowTooShortWarning = {
  code: "ACTIVITY_WINDOW_TOO_SHORT";
  dayNumber: number;
  activityId: string;
  title: string;
  openingHours: { open: string; close: string };
  durationMinutes: number;
  availableMinutes: number;
};

export type ActivityUnassignedWarning = {
  code: "ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS";
  dayNumber: number;
  activityId: string;
  title: string;
  durationMinutes: number;
  reason: "DAY_END" | "ROUTE_CONSTRAINTS";
  dayEndTime: string;
};

export type OptimizeWarning = ActivityWindowTooShortWarning | ActivityUnassignedWarning;

export interface OptimizedDayBase {
  dayNumber: number;
  activities: OptimizedActivity[];
  travelTimesMinutes: number[];
  activityDurationOverloaded: boolean;
  warnings: OptimizeWarning[];
}

export type OptimizedDay =
  | OptimizedDayBase
  | (OptimizedDayBase & {
      matrixActivityIds: string[];
      matrix: number[][];
      transportMode: TransportMode;
      locationFingerprint: string;
      matrixSource: MatrixSource;
      // True when the matrix was reused from cache; such results are NOT
      // written back (we keep the existing, possibly larger, cached matrix).
      reusedCache: boolean;
    });

export interface OptimizeResult {
  order: string[];
  travelTimesMinutes: number[];
  startTimes: string[];
  warnings: OptimizeWarning[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
