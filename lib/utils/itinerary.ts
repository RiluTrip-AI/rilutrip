import type { Day, Itinerary, TripSettings } from "@/types/itinerary";
import { calculateDayDate } from "@/lib/utils/date";

/**
 * Adjust the days array to match a new day count.
 * - Adds blank days at the end when growing.
 * - Removes trailing days when shrinking (caller is responsible for
 *   confirming with the user before calling).
 *
 * @param days         - The current days array
 * @param newDayCount  - The desired total number of days
 * @param tripSettings - The itinerary-level defaults to use when there is no previous day
 * @returns A new days array with the correct length
 */
export function adjustDays(days: Day[], newDayCount: number, tripSettings: TripSettings): Day[] {
  const sorted = [...days].sort((a, b) => a.day_number - b.day_number);
  if (newDayCount > sorted.length) {
    // Inherit time/transport settings from the last existing day
    const ref = sorted[sorted.length - 1] ?? {
      start_time: tripSettings.startTime,
      end_time: tripSettings.endTime,
      transport_mode: tripSettings.transportMode,
    };
    for (let n = sorted.length + 1; n <= newDayCount; n++) {
      sorted.push({
        day_number: n,
        activities: [],
        start_time: ref.start_time,
        end_time: ref.end_time,
        transport_mode: ref.transport_mode,
      });
    }
    return sorted;
  }
  // Trim excess days
  return sorted.filter((d) => d.day_number <= newDayCount);
}

/**
 * Ensure that the itinerary has enough days to cover the target day number.
 * If not, append new empty days and update end_date accordingly.
 *
 * This function mutates the itinerary in-place for compatibility
 * with the operations pipeline.
 *
 * @param itinerary - The itinerary to check / extend
 * @param dayNumber - The day number that must exist
 */
export function ensureDayExists(itinerary: Itinerary, dayNumber: number): void {
  if (dayNumber <= itinerary.days.length) return;

  itinerary.days = adjustDays(itinerary.days, dayNumber, itinerary.settings);
  itinerary.end_date = calculateDayDate(itinerary.start_date, itinerary.days.length);
}
