import { describe, it, expect } from "vitest";
import { buildAdvancedPrefsHint } from "@/lib/utils/advanced-prefs-hint";

describe("buildAdvancedPrefsHint", () => {
  const empty = {
    startTime: "",
    endTime: "",
    lines: { transport: "", time: "" },
  };

  it("returns null when every field is empty", () => {
    expect(buildAdvancedPrefsHint(empty)).toBeNull();
  });

  it("returns null when only one of start/end is filled (incomplete pair)", () => {
    expect(buildAdvancedPrefsHint({ ...empty, startTime: "09:00" })).toBeNull();
    expect(buildAdvancedPrefsHint({ ...empty, endTime: "21:00" })).toBeNull();
  });

  it("emits the time line only when both start and end are filled", () => {
    const hint = buildAdvancedPrefsHint({
      startTime: "08:00",
      endTime: "22:00",
      lines: { transport: "", time: "Daily hours: 08:00 - 22:00" },
    });
    expect(hint).toBe("Daily hours: 08:00 - 22:00");
  });

  it("emits the transport line when a mode is set, gating on the line being non-empty", () => {
    const hint = buildAdvancedPrefsHint({
      ...empty,
      lines: { transport: "Transport mode: Walking", time: "" },
    });
    expect(hint).toBe("Transport mode: Walking");
  });

  it("lists transport above the time range when both are present", () => {
    const hint = buildAdvancedPrefsHint({
      startTime: "08:00",
      endTime: "22:00",
      lines: { transport: "Transport mode: Walking", time: "Daily hours: 08:00 - 22:00" },
    });
    expect(hint).toBe("Transport mode: Walking\nDaily hours: 08:00 - 22:00");
  });

  it("echoes whatever localized text the caller provides verbatim", () => {
    const hint = buildAdvancedPrefsHint({
      startTime: "08:00",
      endTime: "22:00",
      lines: { transport: "交通方式：步行", time: "每日旅遊時間：08:00 - 22:00" },
    });
    expect(hint).toBe("交通方式：步行\n每日旅遊時間：08:00 - 22:00");
  });

  it("ignores a stale time line when the time pair is incomplete", () => {
    const hint = buildAdvancedPrefsHint({
      startTime: "09:00",
      endTime: "",
      lines: { transport: "Transport mode: Walking", time: "Daily hours: 09:00 - " },
    });
    expect(hint).toBe("Transport mode: Walking");
  });
});
