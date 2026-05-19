/**
 * Place Resolver
 *
 * Resolves complete place details (coordinates, rating, opening hours, website)
 * via the backend API proxy (/api/resolve-places) which calls Google Places API.
 */

import type { Location } from "@/types/itinerary";
import { getAccessToken } from "@/lib/supabase/client";

/**
 * Partial location that may be missing coordinates or place details
 */
export interface PartialLocation {
  name: string;
  lat?: number;
  lng?: number;
}

export type ResolveStatus = "success" | "not_found" | "error";

export interface ResolveResult {
  status: ResolveStatus;
  location: Location;
}

/** Shape of each item returned by the /api/resolve-places endpoint */
interface ResolvedPlace {
  id: string;
  name: string;
  place_id?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  user_ratings_total?: number;
  opening_hours?: Record<string, unknown>;
  website?: string;
  error?: string;
}

/**
 * Resolve complete place details via the backend API proxy.
 *
 * Always returns a result with a status (success / not_found / error) and a
 * fallback location on failure. Callers that only need the resolved Location
 * can destructure `{ location }`; callers that want to surface failure reasons
 * to the user can branch on `status`.
 */
export async function resolvePlaceDetails(location: PartialLocation): Promise<ResolveResult> {
  try {
    const token = await getAccessToken();
    const id = crypto.randomUUID();

    const response = await fetch("/api/resolve-places", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({
        places: [
          {
            id,
            name: location.name,
            ...(location.lat !== undefined && { lat: location.lat }),
            ...(location.lng !== undefined && { lng: location.lng }),
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn("API place resolution failed with status:", response.status);
      return { status: "error", location: fallback(location) };
    }

    const data = await response.json();
    const resolved = (data.resolved as ResolvedPlace[] | undefined)?.find((r) => r.id === id);

    if (resolved?.error === "NOT_FOUND") {
      return { status: "not_found", location: fallback(location) };
    }

    if (resolved && !resolved.error) {
      return {
        status: "success",
        location: {
          name: resolved.name || location.name,
          ...(resolved.lat !== undefined && { lat: resolved.lat }),
          ...(resolved.lng !== undefined && { lng: resolved.lng }),
          ...(resolved.place_id !== undefined && { place_id: resolved.place_id }),
          ...(resolved.rating !== undefined && { rating: resolved.rating }),
          ...(resolved.user_ratings_total !== undefined && {
            user_ratings_total: resolved.user_ratings_total,
          }),
          ...(resolved.opening_hours !== undefined && {
            opening_hours: resolved.opening_hours,
          }),
          ...(resolved.website !== undefined && { website: resolved.website }),
        },
      };
    }

    console.warn("No resolved data returned for:", location.name);
    return { status: "error", location: fallback(location) };
  } catch (error) {
    console.error("Error calling /api/resolve-places:", error);
    return { status: "error", location: fallback(location) };
  }
}

function fallback(location: PartialLocation): Location {
  return {
    name: location.name,
    ...(location.lat !== undefined && { lat: location.lat }),
    ...(location.lng !== undefined && { lng: location.lng }),
  };
}
