import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_PATH = resolve(
  __dirname,
  "../../../supabase/migrations/20260529000000_consolidate_itinerary_preference.sql",
);

describe("consolidate_itinerary_preference migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");

  it("renames settings to preference and preferences to description", () => {
    expect(sql).toMatch(/rename column settings to preference/i);
    expect(sql).toMatch(/rename column preferences to description/i);
  });

  it("backfills null preference then sets NOT NULL and a default", () => {
    expect(sql).toMatch(
      /update public\.itineraries[\s\S]*preference[\s\S]*where preference is null/i,
    );
    expect(sql).toMatch(/alter column preference set not null/i);
    const match = sql.match(/set default\s+'([^']+)'::jsonb/i);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1])).toEqual({
      startTime: "09:00",
      endTime: "21:00",
      transportMode: "transit",
    });
  });

  it("renames both check constraints", () => {
    expect(sql).toMatch(
      /rename constraint itineraries_settings_valid to itineraries_preference_valid/i,
    );
    expect(sql).toMatch(
      /rename constraint itineraries_preferences_check to itineraries_description_check/i,
    );
  });

  it("recreates both public RPC functions with renamed columns", () => {
    expect(sql).toMatch(/drop function if exists public\.get_public_itinerary/i);
    expect(sql).toMatch(/drop function if exists public\.update_public_itinerary/i);
    expect(sql).toMatch(/create or replace function "?public"?\."?get_public_itinerary/i);
    expect(sql).toMatch(/create or replace function "?public"?\."?update_public_itinerary/i);
    expect(sql).not.toMatch(/i\.settings/i);
    expect(sql).not.toMatch(/i\.preferences\b/i);
  });

  it("re-grants execute on both recreated RPC functions", () => {
    expect(sql).toMatch(
      /grant all on function "?public"?\."?get_public_itinerary[\s\S]*?authenticated/i,
    );
    expect(sql).toMatch(
      /grant all on function "?public"?\."?update_public_itinerary[\s\S]*?authenticated/i,
    );
  });
});
