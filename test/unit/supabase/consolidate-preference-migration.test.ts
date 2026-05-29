import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_PATH = resolve(
  __dirname,
  "../../../supabase/migrations/20260529000000_consolidate_itinerary_preference.sql",
);

describe("consolidate_itinerary_preference migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");

  it("drops settings and renames preferences to description", () => {
    expect(sql).toMatch(/drop column settings/i);
    expect(sql).toMatch(/rename column preferences to description/i);
  });

  it("does not introduce a preference column", () => {
    expect(sql).not.toMatch(/\bpreference\b/i);
  });

  it("renames the description check constraint", () => {
    expect(sql).toMatch(
      /rename constraint itineraries_preferences_check to itineraries_description_check/i,
    );
  });

  it("recreates both public RPC functions without the dropped columns", () => {
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
