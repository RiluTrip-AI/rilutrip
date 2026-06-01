import type { TransportMode } from "@/types/itinerary";

/**
 * Inputs to the hint builder.
 *
 * Each field uses empty string to mean "user has not set this" — that lets
 * the form start with placeholder-looking inputs (no preselected defaults
 * surfaced as preferences) while keeping the field types simple strings.
 */
export interface AdvancedPrefsHintInput {
  /** Empty/undefined means unset; otherwise HH:MM. */
  startTime?: string;
  /** Empty/undefined means unset; otherwise HH:MM. */
  endTime?: string;
  /** Empty/undefined means unset; otherwise a TransportMode value. */
  transportMode?: TransportMode | "";
  /** Active app locale (e.g. "en" | "zh-TW"). Anything else falls back to en. */
  locale: string;
  /** Localized display name for transportMode (e.g. "Walking" / "步行"). */
  transportModeLabel: string;
}

/**
 * Build the advanced-preferences block appended to the itinerary
 * description (= the AI prompt's customPreferences). Returns a short
 * labeled list — one line per preference the user actually set — or null
 * when the user has expressed nothing (every field empty, or only one of
 * start/end time filled, which is an incomplete pair carrying no useful
 * instruction).
 *
 * Supports partial input: transport mode alone, time range alone, or both.
 * Whatever the user skipped is silently omitted.
 *
 * It stays a hint — sanitizeDayMeta in the edge function remains the source
 * of truth for what actually lands in the day-level metadata.
 */
export function buildAdvancedPrefsHint(input: AdvancedPrefsHintInput): string | null {
  // Treat empty string and undefined identically as "unset". Using truthy
  // checks keeps the rest of the code branch-free.
  const start = input.startTime || "";
  const end = input.endTime || "";
  const mode = input.transportMode || "";

  const hasTimeRange = start !== "" && end !== "";
  const hasTransport = mode !== "";

  if (!hasTimeRange && !hasTransport) return null;

  const isZh = input.locale === "zh-TW";

  const transportLine = hasTransport
    ? isZh
      ? `交通方式：${input.transportModeLabel}`
      : `Transport mode: ${input.transportModeLabel}`
    : "";
  const timeLine = hasTimeRange
    ? isZh
      ? `每日旅遊時間：${start} - ${end}`
      : `Daily hours: ${start} - ${end}`
    : "";

  return [transportLine, timeLine].filter(Boolean).join("\n");
}
