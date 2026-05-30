import { z } from "zod";
import { TransportModeSchema } from "./itinerary";
import {
  DEFAULT_ADVANCED_START_TIME,
  DEFAULT_ADVANCED_END_TIME,
  DEFAULT_ADVANCED_TRANSPORT_MODE,
} from "@/lib/utils/advanced-prefs-hint";

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
      // Advanced-prefs fields. Defaults keep them silent (no hint appended) until
      // the user actually changes them — see lib/utils/advanced-prefs-hint.
      startTime: z
        .string()
        .regex(TIME_PATTERN, t("validation.timeInvalidFormat"))
        .default(DEFAULT_ADVANCED_START_TIME),
      endTime: z
        .string()
        .regex(TIME_PATTERN, t("validation.timeInvalidFormat"))
        .default(DEFAULT_ADVANCED_END_TIME),
      transportMode: TransportModeSchema.default(DEFAULT_ADVANCED_TRANSPORT_MODE),
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

      if (data.startTime >= data.endTime) {
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
