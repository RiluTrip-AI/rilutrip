import { supabase } from "./client";
import type { TransportMode } from "@/types/itinerary";

export interface DayMatrix {
  activityIds: string[];
  matrix: number[][];
  transportMode: TransportMode;
  locationFingerprint: string;
  matrixSource: "google_routes_matrix" | "google_distance_matrix" | "haversine_fallback";
}

export async function loadAllDayMatrices(itineraryId: string): Promise<Map<number, DayMatrix>> {
  const { data, error } = await supabase
    .from("day_matrices")
    .select("day_number, activity_ids, matrix, transport_mode, location_fingerprint, matrix_source")
    .eq("itinerary_id", itineraryId);

  if (error || !data) return new Map();

  return new Map(
    data.map((row) => [
      row.day_number,
      {
        activityIds: row.activity_ids,
        matrix: row.matrix as number[][],
        transportMode: row.transport_mode as TransportMode,
        locationFingerprint: row.location_fingerprint,
        matrixSource: row.matrix_source as DayMatrix["matrixSource"],
      },
    ]),
  );
}

export async function deleteDayMatrix(itineraryId: string, dayNumber: number): Promise<void> {
  const { error } = await supabase
    .from("day_matrices")
    .delete()
    .eq("itinerary_id", itineraryId)
    .eq("day_number", dayNumber);

  if (error) {
    throw new Error(`Failed to delete day matrix: ${error.message}`);
  }
}
