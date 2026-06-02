import { describe, it, expect } from "vitest";
import { createTripFormSchema } from "@/types/forms";

// Identity translator: assertions check the i18n key, not the localized string.
const t = (key: string) => key;

// Valid future dates within the 14-day cap, so only the time fields under test
// drive the validation result.
function validDates() {
  const from = new Date();
  from.setDate(from.getDate() + 30);
  const to = new Date(from);
  to.setDate(from.getDate() + 3);
  return { from, to };
}

function run(fields: Record<string, unknown>) {
  return createTripFormSchema(t).safeParse({
    destination: "Kyoto",
    dates: validDates(),
    ...fields,
  });
}

function issues(result: ReturnType<typeof run>) {
  return result.success
    ? []
    : result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

describe("createTripFormSchema advanced-prefs time validation", () => {
  it("passes when both time fields are empty (advanced prefs untouched)", () => {
    expect(run({ startTime: "", endTime: "" }).success).toBe(true);
  });

  it("flags a half-picked start time as incomplete", () => {
    const result = run({ startTime: "08:", endTime: "" });
    expect(result.success).toBe(false);
    expect(issues(result)).toContainEqual({
      path: "startTime",
      message: "validation.timeIncomplete",
    });
  });

  it("flags a half-picked end time as incomplete", () => {
    const result = run({ startTime: "", endTime: ":30" });
    expect(result.success).toBe(false);
    expect(issues(result)).toContainEqual({
      path: "endTime",
      message: "validation.timeIncomplete",
    });
  });

  it("flags a half-specified range when only the start time is complete", () => {
    const result = run({ startTime: "08:00", endTime: "" });
    expect(result.success).toBe(false);
    expect(issues(result)).toContainEqual({
      path: "endTime",
      message: "validation.timeRangeIncomplete",
    });
  });

  it("flags a half-specified range when only the end time is complete", () => {
    const result = run({ startTime: "", endTime: "20:00" });
    expect(result.success).toBe(false);
    expect(issues(result)).toContainEqual({
      path: "startTime",
      message: "validation.timeRangeIncomplete",
    });
  });

  it("passes when both times are complete and correctly ordered", () => {
    expect(run({ startTime: "08:00", endTime: "20:00" }).success).toBe(true);
  });

  it("flags end before start when both times are complete", () => {
    const result = run({ startTime: "20:00", endTime: "08:00" });
    expect(result.success).toBe(false);
    expect(issues(result)).toContainEqual({
      path: "endTime",
      message: "validation.endTimeAfterStart",
    });
  });
});
