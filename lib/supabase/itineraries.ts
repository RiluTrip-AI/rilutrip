/**
 * Itinerary Data Layer
 *
 * This module provides database operations for itineraries.
 * Handles CRUD operations with proper error handling and RLS enforcement.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { supabase } from "./client";
import type { PostgrestError } from "@supabase/supabase-js";
import {
  DaySchema,
  TripSettingsSchema,
  type Day,
  type Itinerary,
  type TripSettings,
} from "@/types/itinerary";
import type { AccessContext } from "@/types/share";
import type { Database } from "./database.types";

type Json = Database["public"]["Tables"]["itineraries"]["Row"]["data"];
type ItineraryRow = Database["public"]["Tables"]["itineraries"]["Row"];
type ItineraryInsert = Database["public"]["Tables"]["itineraries"]["Insert"];
type ItineraryUpdate = Database["public"]["Tables"]["itineraries"]["Update"];
type ItineraryStatus = Itinerary["status"];

const ITINERARY_LIMIT_ERROR_CODE = "IT001";

/**
 * Error thrown when the user's itinerary cap is reached for their current tier.
 */
export class ItineraryLimitError extends Error {
  constructor() {
    super("The itinerary limit for this account has been reached");
    this.name = "ItineraryLimitError";
  }
}

/**
 * Error thrown when itinerary is not found
 */
export class ItineraryUnavailableError extends Error {
  constructor(id: string) {
    super(`Itinerary with id ${id} not found`);
    this.name = "ItineraryUnavailableError";
  }
}

function isNoRowError(error: unknown): boolean {
  return (error as { code?: string })?.code === "PGRST116";
}

function isItineraryLimitPostgrestError(error: PostgrestError): boolean {
  return error.code === ITINERARY_LIMIT_ERROR_CODE;
}

/**
 * Convert database row to Itinerary type
 */
function rowToItinerary(row: ItineraryRow): Itinerary {
  const data = row.data as unknown as { days?: unknown } | null;
  const settings = TripSettingsSchema.parse(row.settings);
  const days = parsePersistedDays(data?.days, settings);

  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    destination: row.destination,
    start_date: row.start_date,
    end_date: row.end_date,
    preferences: row.preferences || undefined,
    status: row.status as ItineraryStatus,
    days,
    settings,
    link_access: row.link_access,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parsePersistedDays(days: unknown, settings: TripSettings): Day[] {
  if (days === undefined) return [];
  if (!Array.isArray(days)) throw new Error("Itinerary days must be an array");

  return days.map((day) => {
    if (!day || typeof day !== "object" || Array.isArray(day)) {
      throw new Error("Itinerary day must be an object");
    }
    const persistedDay = day as Record<string, unknown>;

    return DaySchema.parse({
      ...persistedDay,
      start_time: "start_time" in persistedDay ? persistedDay.start_time : settings.startTime,
      end_time: "end_time" in persistedDay ? persistedDay.end_time : settings.endTime,
      transport_mode:
        "transport_mode" in persistedDay ? persistedDay.transport_mode : settings.transportMode,
    });
  });
}

/**
 * Load an itinerary from the database by ID
 *
 * Requirements: 10.3
 *
 * @param id - The itinerary ID
 * @returns The loaded itinerary
 * @throws ItineraryUnavailableError if itinerary doesn't exist or user doesn't have access
 * @throws Error if load fails
 */
export async function loadItinerary(id: string): Promise<Itinerary> {
  const { data, error } = await supabase.from("itineraries").select("*").eq("id", id).single();

  if (error) {
    if (isNoRowError(error)) {
      // Row not found or RLS policy violation. Public link access falls back to
      // the SECURITY DEFINER RPC which requires the exact itinerary UUID.
      return loadPublicItineraryViaRpc(id);
    }

    console.error("Error loading itinerary:", error);
    throw new Error(`Failed to load itinerary: ${error.message}`);
  }

  if (!data) {
    throw new ItineraryUnavailableError(id);
  }

  return rowToItinerary(data);
}

async function loadPublicItineraryViaRpc(id: string): Promise<Itinerary> {
  const { data, error } = await (supabase
    .rpc("get_public_itinerary", { p_id: id })
    .single() as unknown as Promise<{
    data: ItineraryRow | null;
    error: PostgrestError | null;
  }>);

  if (error) {
    if (isNoRowError(error)) {
      throw new ItineraryUnavailableError(id);
    }

    console.error("Error loading public itinerary via RPC:", error);
    throw new Error(`Failed to load public itinerary: ${error.message}`);
  }

  if (!data) {
    throw new ItineraryUnavailableError(id);
  }

  return rowToItinerary(data);
}

/**
 * Create itinerary metadata only (without days/activities)
 * Used for "metadata-first" creation flow
 *
 * @param metadata - The itinerary metadata to save
 * @returns The created itinerary with empty days array
 * @throws ItineraryLimitError if user has reached their itinerary limit
 * @throws Error if save fails
 */
export async function createItineraryMetadata(metadata: {
  user_id: string;
  title: string;
  destination: string;
  start_date: string;
  end_date: string;
  preferences?: string;
  settings: TripSettings;
}): Promise<Itinerary> {
  const insertData: ItineraryInsert = {
    user_id: metadata.user_id,
    title: metadata.title,
    destination: metadata.destination,
    start_date: metadata.start_date,
    end_date: metadata.end_date,
    preferences: metadata.preferences || null,
    settings: metadata.settings as unknown as Json,
  };

  const { data, error } = await (supabase
    .from("itineraries")
    .insert(insertData)
    .select()
    .single() as unknown as Promise<{ data: ItineraryRow | null; error: PostgrestError | null }>);

  if (error) {
    if (isItineraryLimitPostgrestError(error)) {
      throw new ItineraryLimitError();
    }

    console.error("Error creating itinerary metadata:", error);
    throw new Error(`Failed to create itinerary metadata: ${error.message}`);
  }

  if (!data) {
    throw new Error("No data returned from insert operation");
  }

  return rowToItinerary(data);
}

export async function updateItinerary(
  id: string,
  updates: Partial<Omit<Itinerary, "id" | "user_id" | "created_at" | "updated_at">>,
  access: AccessContext,
): Promise<Itinerary> {
  if (access.source === "owner" || access.source === "email_share") {
    return updateItineraryViaRls(id, updates);
  }

  if (access.source === "link_share" && access.permission === "edit") {
    return updateItineraryViaRpc(id, updates);
  }

  throw new Error("Current user does not have permission to save this itinerary");
}

async function updateItineraryViaRls(
  id: string,
  updates: Partial<Omit<Itinerary, "id" | "user_id" | "created_at" | "updated_at">>,
): Promise<Itinerary> {
  const updateData = buildItineraryUpdate(updates);
  const { data, error } = await (supabase
    .from("itineraries")
    .update(updateData)
    .eq("id", id)
    .select()
    .single() as unknown as Promise<{ data: ItineraryRow | null; error: PostgrestError | null }>);

  if (error) {
    console.error("Error updating itinerary via RLS:", error);
    throw new Error(`Failed to update itinerary: ${error.message}`);
  }

  if (!data) {
    throw new ItineraryUnavailableError(id);
  }

  return rowToItinerary(data);
}

async function updateItineraryViaRpc(
  id: string,
  updates: Partial<Omit<Itinerary, "id" | "user_id" | "created_at" | "updated_at">>,
): Promise<Itinerary> {
  const updateData = buildItineraryUpdate(updates);
  const { data, error } = await (supabase
    .rpc("update_public_itinerary", {
      p_id: id,
      p_updates: updateData,
    })
    .single() as unknown as Promise<{ data: ItineraryRow | null; error: PostgrestError | null }>);

  if (error) {
    console.error("Error updating public itinerary via RPC:", error);
    throw new Error(`Failed to update public itinerary: ${error.message}`);
  }

  if (!data) {
    throw new ItineraryUnavailableError(id);
  }

  return rowToItinerary(data);
}

function buildItineraryUpdate(
  updates: Partial<Omit<Itinerary, "id" | "user_id" | "created_at" | "updated_at">>,
): ItineraryUpdate {
  const updateData: ItineraryUpdate = {};

  if (updates.title !== undefined) updateData.title = updates.title;
  if (updates.destination !== undefined) {
    updateData.destination = updates.destination;
  }
  if (updates.start_date !== undefined) updateData.start_date = updates.start_date;
  if (updates.end_date !== undefined) updateData.end_date = updates.end_date;
  if (updates.preferences !== undefined) {
    updateData.preferences = updates.preferences || null;
  }

  if (updates.days !== undefined) {
    updateData.data = { days: updates.days } as Json;
  }
  if (updates.settings !== undefined) {
    updateData.settings = updates.settings as unknown as Json;
  }

  return updateData;
}

/**
 * Delete an itinerary from the database
 *
 * Requirements: 10.4
 *
 * @param id - The itinerary ID to delete
 * @throws ItineraryUnavailableError if itinerary doesn't exist or user doesn't have access
 * @throws Error if delete fails
 */
export async function deleteItinerary(id: string): Promise<void> {
  const { error } = await supabase.from("itineraries").delete().eq("id", id);

  if (error) {
    if (error.code === "PGRST116") {
      throw new ItineraryUnavailableError(id);
    }

    console.error("Error deleting itinerary:", error);
    throw new Error(`Failed to delete itinerary: ${error.message}`);
  }
}

/**
 * List summary information for a user's itineraries
 */
export interface ItinerarySummary {
  id: string;
  title: string;
  destination: string;
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
}

/**
 * List all itineraries for the current user
 *
 * Requirements: 10.5
 *
 * @returns Array of itinerary summaries with destination and date information
 * @throws Error if list fails
 */
export async function listUserItineraries(): Promise<ItinerarySummary[]> {
  const { data, error } = await supabase
    .from("itineraries")
    .select("id, title, destination, start_date, end_date, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error listing itineraries:", error);
    throw new Error(`Failed to list itineraries: ${error.message}`);
  }

  return data || [];
}
