import { describe, it, expect } from "vitest";
import { createTripFormSchema, createActivityFormSchema } from "@/types/forms";

describe("Form Schema Factories", () => {
  const mockT = (key: string) => `translated-${key}`;
  const tripDefaults = {
    startTime: "09:00",
    endTime: "21:00",
    transportMode: "driving" as const,
  };

  describe("createTripFormSchema", () => {
    it("should return translated error for missing destination", () => {
      const schema = createTripFormSchema(mockT);
      const result = schema.safeParse({
        destination: "",
        dates: { from: new Date(), to: new Date() },
        ...tripDefaults,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("translated-validation.destinationRequired");
      }
    });

    it("should return translated error for missing start date", () => {
      const schema = createTripFormSchema(mockT);
      const result = schema.safeParse({
        destination: "Tokyo",
        dates: { from: undefined, to: undefined },
        ...tripDefaults,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const dateError = result.error.issues.find((issue) => issue.path.join(".") === "dates");
        expect(dateError?.message).toBe("translated-validation.startDateRequired");
      }
    });

    it("should return translated error when end date is before start date", () => {
      const schema = createTripFormSchema(mockT);
      const start = new Date("2026-05-01");
      const end = new Date("2026-04-01");

      const result = schema.safeParse({
        destination: "Tokyo",
        dates: { from: start, to: end },
        ...tripDefaults,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("translated-validation.endDateAfterStart");
      }
    });
  });

  describe("createActivityFormSchema", () => {
    it("should return translated error for invalid time format", () => {
      const schema = createActivityFormSchema(mockT);
      const result = schema.safeParse({
        title: "Activity",
        locationName: "Tokyo Tower",
        time: "25:99",
        duration: 60,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const timeError = result.error.issues.find((issue) => issue.path.includes("time"));
        expect(timeError?.message).toBe("translated-validation.timeInvalidFormat");
      }
    });

    it("should strip deprecated url input from parsed activity form values", () => {
      const schema = createActivityFormSchema(mockT);
      const result = schema.safeParse({
        title: "Activity",
        locationName: "Tokyo Tower",
        time: "10:00",
        duration: 60,
        url: "https://deprecated.example.com",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty("url");
      }
    });
  });
});
