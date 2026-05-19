/**
 * Itinerary Operations
 *
 * This module provides operation-based itinerary updates.
 * Instead of replacing entire days, LLM can specify granular operations:
 * - ADD: Add new activities
 * - REMOVE: Remove activities
 * - UPDATE: Modify existing activities
 * - MOVE: Move activities between days
 * - REORDER: Change activity order within a day
 *
 * Multiple operations can be applied in a single update.
 */

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { Itinerary, Activity } from "@/types";
import { resolvePlaceDetails } from "@/lib/places/place-resolver";
import { calculateDayDate } from "@/lib/utils/date";
import { ensureDayExists } from "@/lib/utils/itinerary";

// ============================================================================
// Operation Types
// ============================================================================

export const OperationTypeSchema = z.enum(["ADD", "REMOVE", "UPDATE", "MOVE", "REORDER"]);
export type OperationType = z.infer<typeof OperationTypeSchema>;

/**
 * Add new activity to a specific day
 */
export const AddOperationSchema = z.object({
  type: z.literal("ADD"),
  day_number: z.number().int().min(1),
  activity: z.object({
    time: z.string(),
    title: z.string(),
    note: z.string().optional(),
    location: z.object({
      name: z.string(),
    }),
    duration_minutes: z.number().int().positive().optional(),
    insert_at: z.number().int().min(0).optional(), // 0-based position
  }),
});
export type AddOperation = z.infer<typeof AddOperationSchema>;

/**
 * Remove activity from a day
 */
export const RemoveOperationSchema = z.object({
  type: z.literal("REMOVE"),
  day_number: z.number().int().min(1),
  activity_index: z.number().int().min(0).optional(), // Omitted = remove entire day
});
export type RemoveOperation = z.infer<typeof RemoveOperationSchema>;

/**
 * Update existing activity
 */
export const UpdateOperationSchema = z.object({
  type: z.literal("UPDATE"),
  day_number: z.number().int().min(1),
  activity_index: z.number().int().min(0),
  changes: z.object({
    time: z.string().optional(),
    title: z.string().optional(),
    note: z.string().optional(),
    location: z
      .object({
        name: z.string(),
      })
      .optional(),
    duration_minutes: z.number().int().positive().optional(),
  }),
});
export type UpdateOperation = z.infer<typeof UpdateOperationSchema>;

/**
 * Move activity from one day to another
 */
export const MoveOperationSchema = z.object({
  type: z.literal("MOVE"),
  from_day_number: z.number().int().min(1),
  from_activity_index: z.number().int().min(0),
  to_day_number: z.number().int().min(1),
  insert_at: z.number().int().min(0).optional(),
});
export type MoveOperation = z.infer<typeof MoveOperationSchema>;

/**
 * Reorder activities within a day
 */
export const ReorderOperationSchema = z.object({
  type: z.literal("REORDER"),
  day_number: z.number().int().min(1),
  activity_order: z.array(z.number().int().min(0)),
});
export type ReorderOperation = z.infer<typeof ReorderOperationSchema>;

export const OperationSchema = z.discriminatedUnion("type", [
  AddOperationSchema,
  RemoveOperationSchema,
  UpdateOperationSchema,
  MoveOperationSchema,
  ReorderOperationSchema,
]);
export type Operation = z.infer<typeof OperationSchema>;

/**
 * Operations response from LLM
 */
export const OperationsUpdateSchema = z.object({
  operations: z.array(OperationSchema),
});
export type OperationsUpdate = z.infer<typeof OperationsUpdateSchema>;

// ============================================================================
// Apply Operations
// ============================================================================

/**
 * Apply a list of operations to an itinerary with backend location resolution
 *
 * @param itinerary - Current itinerary
 * @param operations - List of operations to apply
 * @returns Updated itinerary
 */
export async function applyOperations(
  itinerary: Itinerary,
  operationsUpdate: OperationsUpdate,
): Promise<Itinerary> {
  // Deep clone to avoid mutating original
  let updated = JSON.parse(JSON.stringify(itinerary)) as Itinerary;

  // Apply each operation in sequence
  for (const operation of operationsUpdate.operations) {
    updated = await applyOperation(updated, operation);
  }

  // Update timestamp
  updated.updated_at = new Date().toISOString();

  return updated;
}

/**
 * Apply a single operation to an itinerary
 */
async function applyOperation(itinerary: Itinerary, operation: Operation): Promise<Itinerary> {
  switch (operation.type) {
    case "ADD":
      return await applyAddOperation(itinerary, operation);
    case "REMOVE":
      return applyRemoveOperation(itinerary, operation);
    case "UPDATE":
      return await applyUpdateOperation(itinerary, operation);
    case "MOVE":
      return applyMoveOperation(itinerary, operation);
    case "REORDER":
      return applyReorderOperation(itinerary, operation);
    default:
      console.warn("Unknown operation type:", operation);
      return itinerary;
  }
}

// ============================================================================
// Individual Operation Handlers
// ============================================================================

/**
 * Add new activity to a day with backend location resolution
 */
async function applyAddOperation(itinerary: Itinerary, op: AddOperation): Promise<Itinerary> {
  ensureDayExists(itinerary, op.day_number);

  const dayIndex = itinerary.days.findIndex((d) => d.day_number === op.day_number);

  if (dayIndex === -1) {
    console.warn(`Day ${op.day_number} not found even after creation`);
    return itinerary;
  }

  // Ensure location has valid coordinates
  const { location } = await resolvePlaceDetails({
    name: op.activity.location.name,
  });

  // Create new activity with generated ID
  const newActivity: Activity = {
    id: uuidv4(),
    time: op.activity.time,
    title: op.activity.title,
    note: op.activity.note || "",
    location,
    duration_minutes: op.activity.duration_minutes || 60,
    order: 0, // Will be recalculated
  };

  const day = itinerary.days[dayIndex];

  // Insert at specific position or append
  if (op.activity.insert_at !== undefined) {
    day.activities.splice(op.activity.insert_at, 0, newActivity);
  } else {
    day.activities.push(newActivity);
  }

  // Recalculate order
  day.activities.forEach((activity, index) => {
    activity.order = index;
  });

  return itinerary;
}

/**
 * Remove activity from a day or remove the entire day
 */
function applyRemoveOperation(itinerary: Itinerary, op: RemoveOperation): Itinerary {
  const dayIndex = itinerary.days.findIndex((d) => d.day_number === op.day_number);

  if (dayIndex === -1) {
    console.warn(`Day ${op.day_number} not found`);
    return itinerary;
  }

  // If activity_index is omitted, remove the entire day
  if (op.activity_index === undefined) {
    // Remove the day
    itinerary.days.splice(dayIndex, 1);

    // Renumber remaining days
    itinerary.days.forEach((day, index) => {
      day.day_number = index + 1;
    });

    // Update end_date based on new duration
    if (itinerary.days.length > 0) {
      itinerary.end_date = calculateDayDate(itinerary.start_date, itinerary.days.length);
    } else {
      itinerary.end_date = itinerary.start_date;
    }

    return itinerary;
  }

  const day = itinerary.days[dayIndex];

  // Use 0-based index directly
  const activityIndex = op.activity_index;

  if (activityIndex < 0 || activityIndex >= day.activities.length) {
    console.warn(
      `Activity index ${op.activity_index} out of range for day ${op.day_number} (has ${day.activities.length} activities)`,
    );
    return itinerary;
  }

  // Remove activity
  day.activities.splice(activityIndex, 1);

  // Recalculate order
  day.activities.forEach((activity, index) => {
    activity.order = index;
  });

  return itinerary;
}

/**
 * Update existing activity with backend location resolution for location changes
 * Note: LLM will only provide the name. The API will resolve lat/lng via the resolver
 */
async function applyUpdateOperation(itinerary: Itinerary, op: UpdateOperation): Promise<Itinerary> {
  const dayIndex = itinerary.days.findIndex((d) => d.day_number === op.day_number);

  if (dayIndex === -1) {
    console.warn(`Day ${op.day_number} not found`);
    return itinerary;
  }

  const day = itinerary.days[dayIndex];

  // Use 0-based index directly
  const activityIndex = op.activity_index;

  if (activityIndex < 0 || activityIndex >= day.activities.length) {
    console.warn(
      `Activity index ${op.activity_index} out of range for day ${op.day_number} (has ${day.activities.length} activities)`,
    );
    return itinerary;
  }

  const activity = day.activities[activityIndex];

  // Apply simple field changes
  if (op.changes.time !== undefined) activity.time = op.changes.time;
  if (op.changes.title !== undefined) activity.title = op.changes.title;
  if (op.changes.note !== undefined) activity.note = op.changes.note;
  if (op.changes.duration_minutes !== undefined)
    activity.duration_minutes = op.changes.duration_minutes;

  // Handle location change
  // LLM will only provide name (required)
  // resolvePlaceDetails will resolve coordinates via API
  if (op.changes.location !== undefined) {
    const { location } = await resolvePlaceDetails({
      name: op.changes.location.name,
    });
    activity.location = location;
  }

  return itinerary;
}

/**
 * Move activity from one day to another
 */
function applyMoveOperation(itinerary: Itinerary, op: MoveOperation): Itinerary {
  ensureDayExists(itinerary, op.to_day_number);

  const fromDayIndex = itinerary.days.findIndex((d) => d.day_number === op.from_day_number);
  const toDayIndex = itinerary.days.findIndex((d) => d.day_number === op.to_day_number);

  if (fromDayIndex === -1) {
    console.warn(`Source day ${op.from_day_number} not found`);
    return itinerary;
  }

  if (toDayIndex === -1) {
    console.warn(`Target day ${op.to_day_number} not found even after creation`);
    return itinerary;
  }

  const fromDay = itinerary.days[fromDayIndex];
  const toDay = itinerary.days[toDayIndex];

  // Use 0-based index directly
  const activityIndex = op.from_activity_index;

  if (activityIndex < 0 || activityIndex >= fromDay.activities.length) {
    console.warn(
      `Activity index ${op.from_activity_index} out of range for day ${op.from_day_number} (has ${fromDay.activities.length} activities)`,
    );
    return itinerary;
  }

  // Remove from source day
  const [activity] = fromDay.activities.splice(activityIndex, 1);

  // Add to target day
  if (op.insert_at !== undefined) {
    // Use 0-based index directly
    toDay.activities.splice(op.insert_at, 0, activity);
  } else {
    toDay.activities.push(activity);
  }

  // Recalculate order for both days
  fromDay.activities.forEach((a, index) => {
    a.order = index;
  });

  toDay.activities.forEach((a, index) => {
    a.order = index;
  });

  return itinerary;
}

/**
 * Reorder activities within a day
 */
function applyReorderOperation(itinerary: Itinerary, op: ReorderOperation): Itinerary {
  const dayIndex = itinerary.days.findIndex((d) => d.day_number === op.day_number);

  if (dayIndex === -1) {
    console.warn(`Day ${op.day_number} not found`);
    return itinerary;
  }

  const day = itinerary.days[dayIndex];

  // Validate indices
  if (op.activity_order.length !== day.activities.length) {
    console.warn(
      `Activity order length (${op.activity_order.length}) doesn't match activities count (${day.activities.length})`,
    );
    return itinerary;
  }

  // Create reordered array based on 0-based indices
  const reordered: Activity[] = [];

  for (const index of op.activity_order) {
    // Use 0-based index directly
    if (index < 0 || index >= day.activities.length) {
      console.warn(`Invalid activity index ${index} in reorder operation`);
      return itinerary;
    }

    reordered.push(day.activities[index]);
  }

  // Update day activities
  day.activities = reordered;

  // Recalculate order
  day.activities.forEach((activity, index) => {
    activity.order = index;
  });

  return itinerary;
}

// ============================================================================
// Parse Operations from LLM Response
// ============================================================================

/**
 * Parse operations from LLM response
 *
 * @param response - LLM response containing operations
 * @returns Parsed operations update
 */
export function parseOperations(
  response: string | Record<string, unknown>,
): OperationsUpdate | null {
  try {
    const data = typeof response === "string" ? JSON.parse(response) : response;

    const result = OperationsUpdateSchema.safeParse(data);

    if (!result.success) {
      console.warn("Zod validation failed for OperationsUpdate:", result.error);
      return null;
    }

    return result.data;
  } catch (error) {
    console.error("Failed to parse operations JSON:", error);
    return null;
  }
}
