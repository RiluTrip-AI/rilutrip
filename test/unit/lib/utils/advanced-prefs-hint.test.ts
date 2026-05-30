import { describe, it, expect } from "vitest";
import {
  buildAdvancedPrefsHint,
  DEFAULT_ADVANCED_START_TIME,
  DEFAULT_ADVANCED_END_TIME,
  DEFAULT_ADVANCED_TRANSPORT_MODE,
} from "@/lib/utils/advanced-prefs-hint";

describe("buildAdvancedPrefsHint", () => {
  const baseInput = {
    startTime: DEFAULT_ADVANCED_START_TIME,
    endTime: DEFAULT_ADVANCED_END_TIME,
    transportMode: DEFAULT_ADVANCED_TRANSPORT_MODE,
    locale: "en",
    transportModeLabel: "Transit",
  };

  it("returns null when all values are at defaults", () => {
    const hint = buildAdvancedPrefsHint(baseInput);
    expect(hint).toBeNull();
  });

  it("returns en hint when any field differs from default (en locale)", () => {
    const hint = buildAdvancedPrefsHint({
      ...baseInput,
      transportMode: "walking",
      transportModeLabel: "Walking",
    });
    expect(hint).toBe(
      "Please plan with a daily window of 09:00–21:00 and prefer Walking when feasible.",
    );
  });

  it("returns zh-TW hint with localized transport label when locale is zh-TW", () => {
    const hint = buildAdvancedPrefsHint({
      ...baseInput,
      locale: "zh-TW",
      startTime: "08:00",
      endTime: "22:00",
      transportMode: "walking",
      transportModeLabel: "步行",
    });
    expect(hint).toBe("請以每日 08:00–22:00、交通方式個人偏好為步行安排行程。");
  });

  it("triggers hint when only one field changed (start time)", () => {
    const hint = buildAdvancedPrefsHint({
      ...baseInput,
      startTime: "07:30",
    });
    expect(hint).not.toBeNull();
    expect(hint).toContain("07:30");
  });

  it("triggers hint when only end time changed", () => {
    const hint = buildAdvancedPrefsHint({
      ...baseInput,
      endTime: "23:00",
    });
    expect(hint).not.toBeNull();
    expect(hint).toContain("23:00");
  });

  it("falls back to en format when locale is neither en nor zh-TW", () => {
    const hint = buildAdvancedPrefsHint({
      ...baseInput,
      locale: "ja",
      transportMode: "driving",
      transportModeLabel: "Driving",
    });
    expect(hint).toBe(
      "Please plan with a daily window of 09:00–21:00 and prefer Driving when feasible.",
    );
  });
});
