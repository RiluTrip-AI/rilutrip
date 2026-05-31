import { z } from "zod";
import { TransportModeSchema } from "./itinerary";

// ============================================================================
// Schema Factory Types
// ============================================================================

export type TranslationFunction = (key: string) => string;

const TIME_PATTERN = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

// ============================================================================
// Landing Page Data Forms
// ============================================================================

export const createTripFormSchema = (t: TranslationFunction) =>
  z
    .object({
      destination: z
        .string()
        .trim()
        .min(1, t("validation.destinationRequired"))
        .max(100, t("validation.destinationMaxLength")),
      dates: z.object({
        from: z.date().optional(),
        to: z.date().optional(),
      }),
      description: z.string().max(1000, t("validation.descriptionMaxLength")).optional(),
      // Advanced-prefs fields. Empty string (or absent) means "not set" so
      // the UI can show placeholders instead of preselected defaults; format
      // and cross-field checks live in superRefine and skip blank values.
      // `.optional()` lets callers omit these (test fixtures, future inputs)
      // without tripping schema-level "required" errors.
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      transportMode: z.union([z.literal(""), TransportModeSchema]).optional(),
    })
    .superRefine((data, ctx) => {
      const { from, to } = data.dates;

      if (!from) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.startDateRequired"),
          path: ["dates"],
        });
        return;
      }

      if (!to) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.endDateRequired"),
          path: ["dates"],
        });
        return;
      }

      if (to < from) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.endDateAfterStart"),
          path: ["dates"],
        });
        return;
      }

      // Prevent selecting past dates
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (from < today) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.pastDateNotAllowed"),
          path: ["dates"],
        });
        return;
      }

      const days = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      if (days > 14) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.dateTooLong"),
          path: ["dates"],
        });
      }

      // Advanced-prefs time validation. Empty/undefined means "not set" and
      // is silent; format errors only fire on actually-typed values, and the
      // cross-field start < end check only fires when both are filled.
      if (data.startTime && !TIME_PATTERN.test(data.startTime)) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.timeInvalidFormat"),
          path: ["startTime"],
        });
      }
      if (data.endTime && !TIME_PATTERN.test(data.endTime)) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.timeInvalidFormat"),
          path: ["endTime"],
        });
      }
      if (data.startTime && data.endTime && data.startTime >= data.endTime) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.endTimeAfterStart"),
          path: ["endTime"],
        });
      }
    });

export type TripFormValues = z.infer<ReturnType<typeof createTripFormSchema>>;

// ============================================================================
// Planner Metadata Forms
// ============================================================================

export const createEditMetadataFormSchema = (t: TranslationFunction) =>
  z
    .object({
      title: z
        .string()
        .trim()
        .min(1, t("validation.titleRequired"))
        .max(100, t("validation.titleMaxLength")),
      destination: z
        .string()
        .trim()
        .min(1, t("validation.destinationRequired"))
        .max(100, t("validation.destinationMaxLength")),
      dates: z.object({
        from: z.date().optional(),
        to: z.date().optional(),
      }),
      description: z.string().max(1000, t("validation.descriptionMaxLength")).optional(),
    })
    .superRefine((data, ctx) => {
      const { from, to } = data.dates;

      if (!from) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.startDateRequired"),
          path: ["dates"],
        });
        return;
      }

      if (!to) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.endDateRequired"),
          path: ["dates"],
        });
        return;
      }

      if (to < from) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.endDateAfterStart"),
          path: ["dates"],
        });
        return;
      }

      const days = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      if (days > 14) {
        ctx.addIssue({
          code: "custom",
          message: t("validation.dateTooLong"),
          path: ["dates"],
        });
      }
    });

export type EditMetadataFormValues = z.infer<ReturnType<typeof createEditMetadataFormSchema>>;

// ============================================================================
// Planner Activity Forms
// ============================================================================

export const createActivityFormSchema = (t: TranslationFunction) =>
  z.object({
    title: z
      .string()
      .trim()
      .min(1, t("validation.activityTitleRequired"))
      .max(100, t("validation.activityTitleMaxLength")),
    locationName: z
      .string()
      .trim()
      .min(1, t("validation.locationRequired"))
      .max(200, t("validation.locationMaxLength")),
    time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, t("validation.timeInvalidFormat")),
    duration: z.coerce
      .number()
      .int()
      .min(1, t("validation.durationMin"))
      .max(1440, t("validation.durationMax")),
    note: z.string().max(500, t("validation.noteMaxLength")).optional(),
  });

export type ActivityFormValues = z.infer<ReturnType<typeof createActivityFormSchema>>;
