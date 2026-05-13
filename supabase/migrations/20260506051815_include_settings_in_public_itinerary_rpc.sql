drop function if exists public.get_public_itinerary(uuid);

create function public.get_public_itinerary(p_id uuid)
returns table(
  id uuid,
  user_id uuid,
  title text,
  destination text,
  start_date date,
  end_date date,
  preferences text,
  status text,
  data jsonb,
  settings jsonb,
  link_access text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    i.id,
    i.user_id,
    i.title,
    i.destination,
    i.start_date,
    i.end_date,
    i.preferences,
    i.status::text,
    i.data,
    i.settings,
    i.link_access::text,
    i.created_at,
    i.updated_at
  from public.itineraries i
  where i.id = p_id
    and i.link_access != 'none';
end;
$$;

drop function if exists public.update_public_itinerary(uuid, jsonb);

create function public.update_public_itinerary(p_id uuid, p_updates jsonb)
returns table(
  id uuid,
  user_id uuid,
  title text,
  destination text,
  start_date date,
  end_date date,
  preferences text,
  status text,
  data jsonb,
  settings jsonb,
  link_access text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.itineraries as i
  set
    title = coalesce(p_updates->>'title', i.title),
    destination = coalesce(p_updates->>'destination', i.destination),
    start_date = coalesce((p_updates->>'start_date')::date, i.start_date),
    end_date = coalesce((p_updates->>'end_date')::date, i.end_date),
    preferences = coalesce(p_updates->>'preferences', i.preferences),
    data = coalesce(p_updates->'data', i.data),
    settings = coalesce(p_updates->'settings', i.settings),
    updated_at = now()
  where i.id = p_id
    and i.link_access = 'edit'
  returning
    i.id,
    i.user_id,
    i.title,
    i.destination,
    i.start_date,
    i.end_date,
    i.preferences,
    i.status::text,
    i.data,
    i.settings,
    i.link_access::text,
    i.created_at,
    i.updated_at;

  if not found then
    raise exception 'Itinerary not found or not editable' using errcode = 'P0002';
  end if;
end;
$$;
