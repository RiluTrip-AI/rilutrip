-- Consolidate trip-level fields:
--   settings    -> dropped      (unused structured field; remove entirely)
--   preferences -> description  (pure rename)

-- 1) drop settings (its CHECK constraint itineraries_settings_valid is dropped with the column)
alter table public.itineraries drop column settings;

-- 2) preferences -> description
alter table public.itineraries rename column preferences to description;
alter table public.itineraries rename constraint itineraries_preferences_check to itineraries_description_check;

-- 3) RPC: RETURNS TABLE column names change -> must DROP + CREATE
drop function if exists public.get_public_itinerary(uuid);
drop function if exists public.update_public_itinerary(uuid, jsonb);

create or replace function "public"."get_public_itinerary"("p_id" "uuid")
  returns table("id" "uuid", "user_id" "uuid", "title" "text", "destination" "text", "start_date" "date", "end_date" "date", "description" "text", "status" "text", "data" "jsonb", "link_access" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
  language "plpgsql" security definer
  set "search_path" to 'public'
  as $$
begin
  return query
  select
    i.id, i.user_id, i.title, i.destination, i.start_date, i.end_date,
    i.description, i.status::text, i.data, i.link_access::text,
    i.created_at, i.updated_at
  from public.itineraries i
  where i.id = p_id and i.link_access != 'none';
end;
$$;
alter function "public"."get_public_itinerary"("p_id" "uuid") owner to "postgres";

create or replace function "public"."update_public_itinerary"("p_id" "uuid", "p_updates" "jsonb")
  returns table("id" "uuid", "user_id" "uuid", "title" "text", "destination" "text", "start_date" "date", "end_date" "date", "description" "text", "status" "text", "data" "jsonb", "link_access" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
  language "plpgsql" security definer
  set "search_path" to 'public'
  as $$
begin
  return query
  update public.itineraries as i
  set
    title = coalesce(p_updates->>'title', i.title),
    destination = coalesce(p_updates->>'destination', i.destination),
    start_date = coalesce((p_updates->>'start_date')::date, i.start_date),
    end_date = coalesce((p_updates->>'end_date')::date, i.end_date),
    description = coalesce(p_updates->>'description', i.description),
    data = coalesce(p_updates->'data', i.data),
    updated_at = now()
  where i.id = p_id and i.link_access = 'edit'
  returning
    i.id, i.user_id, i.title, i.destination, i.start_date, i.end_date,
    i.description, i.status::text, i.data, i.link_access::text,
    i.created_at, i.updated_at;

  if not found then
    raise exception 'Itinerary not found or not editable' using errcode = 'P0002';
  end if;
end;
$$;
alter function "public"."update_public_itinerary"("p_id" "uuid", "p_updates" "jsonb") owner to "postgres";

-- DROP removed the original GRANTs; re-grant (else public share/edit via RPC = permission denied).
grant all on function "public"."get_public_itinerary"("p_id" "uuid") to "anon", "authenticated", "service_role";
grant all on function "public"."update_public_itinerary"("p_id" "uuid", "p_updates" "jsonb") to "anon", "authenticated", "service_role";
