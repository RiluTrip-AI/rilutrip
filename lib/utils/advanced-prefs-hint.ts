/**
 * Inputs to the hint builder. Time values use empty string / undefined to
 * mean "unset"; the localized `lines` are resolved by the caller so this util
 * stays free of i18n wiring.
 */
export interface AdvancedPrefsHintInput {
  startTime?: string;
  endTime?: string;
  lines: {
    /** Full transport line, e.g. "Transport mode: Walking". Empty = no mode picked. */
    transport: string;
    /** Full daily-hours line, e.g. "Daily hours: 08:00 - 22:00". */
    time: string;
  };
}

/**
 * Build the advanced-preferences block appended to the itinerary description
 * (= the AI prompt's customPreferences): one line per preference the user set,
 * or null when nothing useful was expressed. Transport is listed above time.
 */
export function buildAdvancedPrefsHint(input: AdvancedPrefsHintInput): string | null {
  const start = input.startTime || "";
  const end = input.endTime || "";

  const hasTimeRange = start !== "" && end !== "";
  const hasTransport = input.lines.transport !== "";

  if (!hasTimeRange && !hasTransport) return null;

  return [hasTransport ? input.lines.transport : "", hasTimeRange ? input.lines.time : ""]
    .filter(Boolean)
    .join("\n");
}
