import { describe, it, expect } from "vitest";
import { createTripFormSchema, createActivityFormSchema } from "@/types/forms";

describe("Zod i18n Integration E2E", () => {
  const tripDefaults = {
    startTime: "09:00",
    endTime: "21:00",
    transportMode: "driving" as const,
  };

  describe("English translations", () => {
    const enMessages = {
      "validation.destinationRequired": "Destination is required",
      "validation.startDateRequired": "Start date is required",
      "validation.endDateRequired": "End date is required",
      "validation.endDateAfterStart": "End date must be on or after start date",
      "validation.titleRequired": "Title is required",
      "validation.activityTitleRequired": "Activity title is required",
      "validation.locationRequired": "Location is required",
      "validation.timeInvalidFormat": "Time must be in HH:MM format",
      "validation.durationMin": "Duration must be at least 1 minute",
      "validation.invalidUrl": "Must be a valid URL",
    };

    const tEn = (key: string) => enMessages[key as keyof typeof enMessages] || key;

    it("should return English error for missing destination in TripForm", () => {
      const schema = createTripFormSchema(tEn);
      const result = schema.safeParse({
        destination: "",
        dates: { from: new Date(), to: new Date() },
        ...tripDefaults,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Destination is required");
      }
    });

    it("should return English error for date range validation", () => {
      const schema = createTripFormSchema(tEn);
      const start = new Date("2026-05-01");
      const end = new Date("2026-04-01");

      const result = schema.safeParse({
        destination: "Tokyo",
        dates: { from: start, to: end },
        ...tripDefaults,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("End date must be on or after start date");
      }
    });

    it("should return English error for invalid time format", () => {
      const schema = createActivityFormSchema(tEn);
      const result = schema.safeParse({
        title: "Activity",
        locationName: "Tokyo Tower",
        time: "invalid",
        duration: 60,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const timeError = result.error.issues.find((issue) => issue.path.includes("time"));
        expect(timeError?.message).toBe("Time must be in HH:MM format");
      }
    });
  });

  describe("Traditional Chinese translations", () => {
    const zhMessages = {
      "validation.destinationRequired": "請輸入目的地",
      "validation.startDateRequired": "請選擇開始日期",
      "validation.endDateRequired": "請選擇結束日期",
      "validation.endDateAfterStart": "結束日期必須在開始日期之後或相同",
      "validation.titleRequired": "請輸入標題",
      "validation.activityTitleRequired": "請輸入活動標題",
      "validation.locationRequired": "請輸入地點",
      "validation.timeInvalidFormat": "時間格式必須為 HH:MM",
      "validation.durationMin": "持續時間至少 1 分鐘",
      "validation.invalidUrl": "必須是有效的網址",
    };

    const tZh = (key: string) => zhMessages[key as keyof typeof zhMessages] || key;

    it("should return Chinese error for missing destination in TripForm", () => {
      const schema = createTripFormSchema(tZh);
      const result = schema.safeParse({
        destination: "",
        dates: { from: new Date(), to: new Date() },
        ...tripDefaults,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("請輸入目的地");
      }
    });

    it("should return Chinese error for date range validation", () => {
      const schema = createTripFormSchema(tZh);
      const start = new Date("2026-05-01");
      const end = new Date("2026-04-01");

      const result = schema.safeParse({
        destination: "Tokyo",
        dates: { from: start, to: end },
        ...tripDefaults,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("結束日期必須在開始日期之後或相同");
      }
    });

    it("should return Chinese error for invalid time format", () => {
      const schema = createActivityFormSchema(tZh);
      const result = schema.safeParse({
        title: "Activity",
        locationName: "Tokyo Tower",
        time: "invalid",
        duration: 60,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const timeError = result.error.issues.find((issue) => issue.path.includes("time"));
        expect(timeError?.message).toBe("時間格式必須為 HH:MM");
      }
    });
  });
});
