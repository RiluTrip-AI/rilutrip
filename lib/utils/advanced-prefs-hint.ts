import type { TransportMode } from "@/types/itinerary";

/**
 * Defaults for the landing form's advanced preferences section.
 *
 * These match the values shown when the user has not touched the section, and
 * are used to decide whether the user has actually expressed a preference
 * worth surfacing to the AI. If you change a default here, also update the
 * form's `defaultValues`.
 */
export const DEFAULT_ADVANCED_START_TIME = "09:00";
export const DEFAULT_ADVANCED_END_TIME = "21:00";
export const DEFAULT_ADVANCED_TRANSPORT_MODE: TransportMode = "transit";

export interface AdvancedPrefsHintInput {
  startTime: string;
  endTime: string;
  transportMode: TransportMode;
  /** Active app locale (e.g. "en" | "zh-TW"). Anything else falls back to en. */
  locale: string;
  /** Localized display name for transportMode (e.g. "Walking" / "步行"). */
  transportModeLabel: string;
}

/**
 * Build a single sentence to append to the AI prompt's customPreferences
 * (= itinerary description). Returns null when every field is still at its
 * default — silence is correct because the user has expressed no preference.
 *
 * The UI keeps the advanced section collapsed by default, so the only way for
 * any of these fields to differ from a default is for the user to have opened
 * the section and interacted with a control. That means "differs from default"
 * already captures the "user engaged" intent without a separate flag.
 *
 * The output is a clear instruction so the AI is unlikely to ignore it, while
 * still being a hint — sanitizeDayMeta in the edge function remains the source
 * of truth for what actually lands in the day-level metadata.
 */
export function buildAdvancedPrefsHint(input: AdvancedPrefsHintInput): string | null {
  const changed =
    input.startTime !== DEFAULT_ADVANCED_START_TIME ||
    input.endTime !== DEFAULT_ADVANCED_END_TIME ||
    input.transportMode !== DEFAULT_ADVANCED_TRANSPORT_MODE;
  if (!changed) return null;

  const { startTime, endTime, transportModeLabel } = input;

  if (input.locale === "zh-TW") {
    return `請以每日 ${startTime}–${endTime}、交通方式個人偏好為${transportModeLabel}安排行程。`;
  }
  return `Please plan with a daily window of ${startTime}–${endTime} and prefer ${transportModeLabel} when feasible.`;
}
