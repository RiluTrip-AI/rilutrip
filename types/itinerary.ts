import { z } from "zod";
import { LinkAccessSchema } from "./share";

// ============================================================================
// Location Types
// ============================================================================

export const LocationSchema = z.object({
  name: z.string().min(1, "Location name is required").max(200, "Location name is too long"),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  place_id: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  user_ratings_total: z.number().int().min(0).optional(),
  opening_hours: z.record(z.string(), z.unknown()).optional(),
  website: z.string().url().optional(),
});

export type Location = z.infer<typeof LocationSchema>;

// ============================================================================
// Activity Types
// ============================================================================

const TimeHHMMSchema = z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/);

export const ActivitySchema = z.object({
  id: z.uuid(),
  time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Time must be in HH:MM format"),
  title: z.string().min(1, "Activity title is required").max(100),
  note: z.string().max(500),
  location: LocationSchema,
  duration_minutes: z.number().int().min(1).max(480),
  order: z.number().int().min(0),
  type: z.enum(["lunch", "dinner", "breakfast", "transit"]).optional(),
  url: z.string().url().optional(),
  opening_hours: z.object({ open: TimeHHMMSchema, close: TimeHHMMSchema }).optional(),
});

export type Activity = z.infer<typeof ActivitySchema>;

export const OptimizeWarningSchema = z.discriminatedUnion("code", [
  z.object({
    code: z.literal("ACTIVITY_WINDOW_TOO_SHORT"),
    dayNumber: z.number().int().positive(),
    activityId: z.uuid(),
    title: z.string(),
    openingHours: z.object({ open: TimeHHMMSchema, close: TimeHHMMSchema }),
    durationMinutes: z.number().int().positive(),
    availableMinutes: z.number().int().min(0),
  }),
  z.object({
    code: z.literal("ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS"),
    dayNumber: z.number().int().positive(),
    activityId: z.uuid(),
    title: z.string(),
    durationMinutes: z.number().int().positive(),
    reason: z.enum(["DAY_END", "ROUTE_CONSTRAINTS"]).optional(),
    dayEndTime: TimeHHMMSchema.optional(),
  }),
]);

export type OptimizeWarning = z.infer<typeof OptimizeWarningSchema>;

// Activity with day number (for components that need day association)
export type ActivityWithDay = Activity & { dayNumber: number };

// ============================================================================
// Day Types
// ============================================================================

export const TransportModeSchema = z.enum(["driving", "walking", "transit", "bicycling"]);
export type TransportMode = z.infer<typeof TransportModeSchema>;

export const DaySchema = z
  .object({
    day_number: z.number().int().min(1).max(30),
    activities: z.array(ActivitySchema),
    start_time: z
      .string()
      .regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, "Time must be in HH:MM format"),
    end_time: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, "Time must be in HH:MM format"),
    transport_mode: TransportModeSchema,
    optimization_warnings: z.array(OptimizeWarningSchema).optional(),
  })
  .refine((data) => data.start_time < data.end_time, {
    message: "End time must be after start time",
    path: ["end_time"],
  });

export type Day = z.infer<typeof DaySchema>;

// ============================================================================
// Trip Settings Types
// ============================================================================

export const TripSettingsSchema = z.object({
  startTime: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/),
  endTime: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/),
  transportMode: TransportModeSchema,
});

export type TripSettings = z.infer<typeof TripSettingsSchema>;

export { DEFAULT_TRIP_SETTINGS } from "@/shared/trip-settings";

// ============================================================================
// Itinerary Types
// ============================================================================

export const ItinerarySchema = z
  .object({
    id: z.uuid(),
    user_id: z.uuid(),
    title: z.string().min(1, "Title is required").max(100),
    destination: z.string().min(1, "Destination is required").max(100),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be in YYYY-MM-DD format"),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be in YYYY-MM-DD format"),
    preferences: z.string().max(1000, "Preferences are too long").optional(),
    status: z.enum(["draft", "generating", "completed", "failed"]).optional(),
    days: z.array(DaySchema),
    settings: TripSettingsSchema,
    link_access: LinkAccessSchema.default("none"),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .refine((data) => data.end_date >= data.start_date, {
    message: "End date must be on or after start date",
    path: ["end_date"],
  });

export type Itinerary = z.infer<typeof ItinerarySchema>;
