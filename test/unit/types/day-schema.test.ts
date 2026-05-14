import { describe, it, expect } from "vitest";
import { DaySchema } from "@/types/itinerary";

const baseDay = {
  day_number: 1,
  activities: [],
  start_time: "09:00",
  end_time: "21:00",
  transport_mode: "driving" as const,
};

describe("DaySchema - start_time / end_time", () => {
  it("passes with all required fields", () => {
    expect(() => DaySchema.parse(baseDay)).not.toThrow();
  });

  it("passes with valid start_time and end_time", () => {
    expect(() =>
      DaySchema.parse({ ...baseDay, start_time: "08:00", end_time: "21:00" }),
    ).not.toThrow();
  });

  it("passes with boundary values 00:00 and 23:59", () => {
    expect(() =>
      DaySchema.parse({ ...baseDay, start_time: "00:00", end_time: "23:59" }),
    ).not.toThrow();
  });

  it("throws when start_time is missing leading zero (e.g. 8:00 instead of 08:00)", () => {
    expect(() => DaySchema.parse({ ...baseDay, start_time: "8:00" })).toThrow();
  });

  it("throws when hour exceeds 23", () => {
    expect(() => DaySchema.parse({ ...baseDay, start_time: "25:00" })).toThrow();
  });

  it("throws when minute exceeds 59", () => {
    expect(() => DaySchema.parse({ ...baseDay, end_time: "10:60" })).toThrow();
  });

  it("throws when format has no colon", () => {
    expect(() => DaySchema.parse({ ...baseDay, start_time: "0800" })).toThrow();
  });

  it("throws when value is a text string", () => {
    expect(() => DaySchema.parse({ ...baseDay, start_time: "morning" })).toThrow();
  });

  it("throws when start_time is missing", () => {
    const { start_time: _, ...without } = baseDay;
    expect(() => DaySchema.parse(without)).toThrow();
  });

  it("throws when end_time is missing", () => {
    const { end_time: _, ...without } = baseDay;
    expect(() => DaySchema.parse(without)).toThrow();
  });

  it("parsed result includes start_time and end_time", () => {
    const result = DaySchema.parse({
      ...baseDay,
      start_time: "09:00",
      end_time: "20:00",
    });
    expect(result.start_time).toBe("09:00");
    expect(result.end_time).toBe("20:00");
  });

  // Time range validation tests
  it("throws when start_time equals end_time", () => {
    expect(() => DaySchema.parse({ ...baseDay, start_time: "10:00", end_time: "10:00" })).toThrow(
      "End time must be after start time",
    );
  });

  it("throws when start_time is after end_time", () => {
    expect(() => DaySchema.parse({ ...baseDay, start_time: "20:00", end_time: "08:00" })).toThrow(
      "End time must be after start time",
    );
  });

  it("throws when start_time is one minute before midnight and end_time is midnight", () => {
    expect(() => DaySchema.parse({ ...baseDay, start_time: "23:59", end_time: "00:00" })).toThrow(
      "End time must be after start time",
    );
  });

  it("passes when start_time is midnight and end_time is one minute after", () => {
    expect(() =>
      DaySchema.parse({ ...baseDay, start_time: "00:00", end_time: "00:01" }),
    ).not.toThrow();
  });

  it("passes when start_time is one minute before end_time", () => {
    expect(() =>
      DaySchema.parse({ ...baseDay, start_time: "10:00", end_time: "10:01" }),
    ).not.toThrow();
  });
});
