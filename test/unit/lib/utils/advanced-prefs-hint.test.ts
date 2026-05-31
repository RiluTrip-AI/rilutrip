import { describe, it, expect } from "vitest";
import { buildAdvancedPrefsHint } from "@/lib/utils/advanced-prefs-hint";

describe("buildAdvancedPrefsHint", () => {
  const empty = {
    startTime: "",
    endTime: "",
    transportMode: "" as const,
    locale: "en",
    transportModeLabel: "",
  };

  it("returns null when every field is empty", () => {
    expect(buildAdvancedPrefsHint(empty)).toBeNull();
  });

  it("returns null when only one of start/end is filled (incomplete pair)", () => {
    expect(buildAdvancedPrefsHint({ ...empty, startTime: "09:00" })).toBeNull();
    expect(buildAdvancedPrefsHint({ ...empty, endTime: "21:00" })).toBeNull();
  });

  it("emits time-only sentence when only the time range is filled (en)", () => {
    const hint = buildAdvancedPrefsHint({
      ...empty,
      startTime: "08:00",
      endTime: "22:00",
    });
    expect(hint).toBe("Please plan with a daily window of 08:00–22:00.");
  });

  it("emits time-only sentence when only the time range is filled (zh-TW)", () => {
    const hint = buildAdvancedPrefsHint({
      ...empty,
      locale: "zh-TW",
      startTime: "08:00",
      endTime: "22:00",
    });
    expect(hint).toBe("請以每日 08:00–22:00安排行程。");
  });

  it("emits transport-only sentence when only transport mode is filled (en)", () => {
    const hint = buildAdvancedPrefsHint({
      ...empty,
      transportMode: "walking",
      transportModeLabel: "Walking",
    });
    expect(hint).toBe("Please prefer Walking when feasible.");
  });

  it("emits transport-only sentence when only transport mode is filled (zh-TW)", () => {
    const hint = buildAdvancedPrefsHint({
      ...empty,
      locale: "zh-TW",
      transportMode: "walking",
      transportModeLabel: "步行",
    });
    expect(hint).toBe("請以交通方式個人偏好為步行安排行程。");
  });

  it("combines both pieces when time range and transport are both filled (en)", () => {
    const hint = buildAdvancedPrefsHint({
      startTime: "08:00",
      endTime: "22:00",
      transportMode: "walking",
      transportModeLabel: "Walking",
      locale: "en",
    });
    expect(hint).toBe(
      "Please plan with a daily window of 08:00–22:00 and prefer Walking when feasible.",
    );
  });

  it("combines both pieces in zh-TW", () => {
    const hint = buildAdvancedPrefsHint({
      startTime: "08:00",
      endTime: "22:00",
      transportMode: "walking",
      transportModeLabel: "步行",
      locale: "zh-TW",
    });
    expect(hint).toBe("請以每日 08:00–22:00、交通方式個人偏好為步行安排行程。");
  });

  it("falls back to en formatting when locale is neither en nor zh-TW", () => {
    const hint = buildAdvancedPrefsHint({
      ...empty,
      locale: "ja",
      transportMode: "driving",
      transportModeLabel: "Driving",
    });
    expect(hint).toBe("Please prefer Driving when feasible.");
  });
});
