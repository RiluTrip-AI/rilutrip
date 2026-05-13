import { createSupabaseAdminClient } from "./supabase.ts";

const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");

const supabase = createSupabaseAdminClient();

export interface PlaceInput {
  id: string;
  name: string;
  lat?: number;
  lng?: number;
}

export interface ResolvedPlace {
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

// ──────────────────────────────────────────────
// Google Maps API (New) constants
// ──────────────────────────────────────────────

const BASE_URL = "https://places.googleapis.com/v1";

// Field mask for Details - mapped to our database schema
const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "location",
  "rating",
  "userRatingCount",
  "websiteUri",
  "regularOpeningHours",
].join(",");

const MAX_RETRIES = 3;

// Cap concurrent Google Places calls. 5 is well under per-second quota and
// avoids 429s while keeping latency low for the common batch size of ~10.
const RESOLVE_BATCH_SIZE = 5;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimitedFetch(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  const resp = await fetch(url, options);

  if (resp.status === 429 && retries > 0) {
    const backoff = Math.pow(2, MAX_RETRIES - retries) * 1000;
    await delay(backoff);
    return rateLimitedFetch(url, options, retries - 1);
  } else if (resp.status === 429 && retries === 0) {
    console.error(`[rateLimitedFetch] 429 Too Many Requests, retry quota exhausted for ${url}`);
    throw new Error(
      `Google Maps API Error: 429 Too Many Requests - retry quota exhausted for ${url}`,
    );
  }

  return resp;
}

// ──────────────────────────────────────────────
// Google Maps helpers
// ──────────────────────────────────────────────

async function findPlace(name: string, lat?: number, lng?: number): Promise<string | null> {
  if (!apiKey) {
    console.error("Missing GOOGLE_MAPS_API_KEY environment variable");
    return null;
  }

  const url = `${BASE_URL}/places:searchText`;
  const body: Record<string, unknown> = {
    textQuery: name,
    languageCode: "zh-TW",
  };

  if (lat !== undefined && lng !== undefined) {
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
      },
    };
  }

  try {
    const resp = await rateLimitedFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.warn(`[findPlace] HTTP Error ${resp.status}: ${resp.statusText}`, errorText);
      throw new Error(`Google Maps API Error: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json();
    const places = data.places ?? [];

    if (places.length === 0) {
      console.log(`[findPlace] no candidates returned for '${name}'`);
      return null;
    }

    return places[0].id ?? null;
  } catch (err) {
    console.error(`[findPlace] Exception for '${name}':`, err);
    throw err;
  }
}

async function getPlaceDetails(placeId: string): Promise<Record<string, unknown> | null> {
  if (!apiKey) {
    console.error("Missing GOOGLE_MAPS_API_KEY environment variable");
    return null;
  }

  const url = `${BASE_URL}/places/${placeId}?languageCode=zh-TW`;

  try {
    const resp = await rateLimitedFetch(url, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": DETAILS_FIELD_MASK,
      },
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.warn(`[getPlaceDetails] HTTP Error ${resp.status}: ${resp.statusText}`, errorText);
      throw new Error(`Google Maps API Error: ${resp.status} ${resp.statusText}`);
    }

    return await resp.json();
  } catch (err) {
    console.error(`[getPlaceDetails] Exception for ${placeId}:`, err);
    throw err;
  }
}

async function checkPlaceCache(placeId: string): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase
      .from("google_places")
      .select("*")
      .eq("place_id", placeId)
      .maybeSingle();

    if (error) {
      console.warn(`[checkPlaceCache] Supabase error for ${placeId}:`, error.message);
      return null;
    }

    if (!data) return null;
    return data as Record<string, unknown>;
  } catch (err) {
    console.error(`[checkPlaceCache] Exception for ${placeId}:`, err);
    return null;
  }
}

async function checkPlaceCacheByName(name: string): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase
      .from("google_places")
      .select("*")
      .ilike("name", name)
      .maybeSingle();

    if (error) {
      console.warn(`[checkPlaceCacheByName] Supabase error for '${name}':`, error.message);
      return null;
    }

    if (!data) return null;
    return data as Record<string, unknown>;
  } catch (err) {
    console.error(`[checkPlaceCacheByName] Exception for '${name}':`, err);
    return null;
  }
}

async function savePlaceCache(row: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await supabase.from("google_places").upsert(row, { onConflict: "place_id" });

    if (error) {
      console.error(`[savePlaceCache] Supabase error:`, error.message);
    }
  } catch (err) {
    console.error(`[savePlaceCache] Exception:`, err);
  }
}

// ──────────────────────────────────────────────
// Core resolve logic (per place)
// ──────────────────────────────────────────────

function normalizeCachedPlace(
  row: Record<string, unknown>,
  fallbackName: string,
): Omit<ResolvedPlace, "id"> {
  return {
    place_id: (row.place_id as string) ?? undefined,
    name: (row.name as string) ?? fallbackName,
    lat: (row.lat as number) ?? undefined,
    lng: (row.lng as number) ?? undefined,
    rating: (row.rating as number) ?? undefined,
    user_ratings_total: (row.user_ratings_total as number) ?? undefined,
    opening_hours: (row.opening_hours as Record<string, unknown>) ?? undefined,
    website: (row.website as string) ?? undefined,
  };
}

async function resolvePlace(input: PlaceInput): Promise<ResolvedPlace> {
  input.name = input.name.trim();
  const base: ResolvedPlace = { id: input.id, name: input.name };

  if (input.lat === undefined || input.lng === undefined) {
    const cachedByName = await checkPlaceCacheByName(input.name);
    if (cachedByName) {
      return {
        id: input.id,
        ...normalizeCachedPlace(cachedByName, input.name),
      };
    }
  }

  const placeId = await findPlace(input.name, input.lat, input.lng);
  if (!placeId) {
    console.warn(`[resolvePlace] no place_id found for '${input.name}'`);
    return { ...base, error: "NOT_FOUND" };
  }

  const cached = await checkPlaceCache(placeId);
  if (cached) {
    return {
      id: input.id,
      ...normalizeCachedPlace(cached, input.name),
      place_id: placeId, // placeId from findPlace() is prior to cache
    };
  }

  const details = await getPlaceDetails(placeId);

  if (!details) {
    console.warn(`[resolvePlace] no details found for '${input.name}'`);
    return { ...base, place_id: placeId, error: "DETAILS_UNAVAILABLE" };
  }

  // Parse all fields from the New Places API structure
  const displayName = (details.displayName as Record<string, string>)?.text;
  const location = details.location as Record<string, number>;

  const data = {
    place_id: placeId,
    name: displayName ?? input.name,
    lat: location?.latitude,
    lng: location?.longitude,
    rating: (details.rating as number) ?? undefined,
    user_ratings_total: (details.userRatingCount as number) ?? undefined,
    website: (details.websiteUri as string) ?? undefined,
    opening_hours: (details.regularOpeningHours as Record<string, unknown>) ?? undefined,
  };

  // Step 4: Save to cache
  await savePlaceCache(data);

  return { id: input.id, ...data };
}

export async function resolvePlacesInfo(places: PlaceInput[]): Promise<ResolvedPlace[]> {
  const resolved: ResolvedPlace[] = [];
  for (let i = 0; i < places.length; i += RESOLVE_BATCH_SIZE) {
    const batch = places.slice(i, i + RESOLVE_BATCH_SIZE);
    const results = await Promise.all(batch.map(resolvePlace));
    resolved.push(...results);
  }
  return resolved;
}
