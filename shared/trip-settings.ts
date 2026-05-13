/**
 * Default trip-level time and transport settings. Plain values only (no Zod,
 * Next.js, or Deno deps) so Edge Functions and Next.js code share one source
 * of truth, mirroring the `shared/credit-costs.ts` pattern.
 */
export const DEFAULT_TRIP_SETTINGS = {
  startTime: "09:00",
  endTime: "21:00",
  transportMode: "driving",
} as const;
