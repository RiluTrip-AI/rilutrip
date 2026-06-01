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

  it("emits a time-only line when only the time range is filled (en)", () => {
    const hint = buildAdvancedPrefsHint({
      ...empty,
      startTime: "08:00",
      endTime: "22:00",
    });
    expect(hint).toBe("Daily hours: 08:00 - 22:00");
  });

  it("emits a time-only line when only the time range is filled (zh-TW)", () => {
    const hint = buildAdvancedPrefsHint({
      ...empty,
      locale: "zh-TW",
      startTime: "08:00",
      endTime: "22:00",
    });
    expect(hint).toBe("每日旅遊時間：08:00 - 22:00");
  });

  it("emits a transport-only line when only transport mode is filled (en)", () => {
    const hint = buildAdvancedPrefsHint({
      ...empty,
      transportMode: "walking",
      transportModeLabel: "Walking",
    });
    expect(hint).toBe("Transport mode: Walking");
  });

  it("emits a transport-only line when only transport mode is filled (zh-TW)", () => {
    const hint = buildAdvancedPrefsHint({
      ...empty,
      locale: "zh-TW",
      transportMode: "walking",
      transportModeLabel: "步行",
    });
    expect(hint).toBe("交通方式：步行");
  });

  it("lists transport above the time range when both are filled (en)", () => {
    const hint = buildAdvancedPrefsHint({
      startTime: "08:00",
      endTime: "22:00",
      transportMode: "walking",
      transportModeLabel: "Walking",
      locale: "en",
    });
    expect(hint).toBe("Transport mode: Walking\nDaily hours: 08:00 - 22:00");
  });

  it("lists transport above the time range when both are filled (zh-TW)", () => {
    const hint = buildAdvancedPrefsHint({
      startTime: "08:00",
      endTime: "22:00",
      transportMode: "walking",
      transportModeLabel: "步行",
      locale: "zh-TW",
    });
    expect(hint).toBe("交通方式：步行\n每日旅遊時間：08:00 - 22:00");
  });

  it("falls back to en formatting when locale is neither en nor zh-TW", () => {
    const hint = buildAdvancedPrefsHint({
      ...empty,
      locale: "ja",
      transportMode: "driving",
      transportModeLabel: "Driving",
    });
    expect(hint).toBe("Transport mode: Driving");
  });
});
