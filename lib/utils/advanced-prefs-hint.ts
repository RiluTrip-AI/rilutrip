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
 * Build a single sentence to append to the AI prompt's customPreferences
 * (= itinerary description). Returns null when the user has expressed
 * nothing — every field empty, or only one of start/end time filled (an
 * incomplete pair carries no useful instruction).
 *
 * Supports partial input: time range alone, transport mode alone, or both.
 * Whatever the user actually filled goes into the sentence; whatever they
 * skipped is silently omitted.
 *
 * The output is a clear instruction so the AI is unlikely to ignore it,
 * while still being a hint — sanitizeDayMeta in the edge function remains
 * the source of truth for what actually lands in the day-level metadata.
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

  if (isZh) {
    const timePart = hasTimeRange ? `每日 ${start}–${end}` : "";
    const transportPart = hasTransport ? `交通方式個人偏好為${input.transportModeLabel}` : "";
    const body = [timePart, transportPart].filter(Boolean).join("、");
    return `請以${body}安排行程。`;
  }

  const timePart = hasTimeRange ? `a daily window of ${start}–${end}` : "";
  const transportPart = hasTransport ? `prefer ${input.transportModeLabel} when feasible` : "";

  if (hasTimeRange && hasTransport) {
    return `Please plan with ${timePart} and ${transportPart}.`;
  }
  if (hasTimeRange) {
    return `Please plan with ${timePart}.`;
  }
  return `Please ${transportPart}.`;
}
