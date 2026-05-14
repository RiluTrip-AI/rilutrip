-- Backfill any existing NULL settings with safe defaults so the NOT NULL
-- constraint can be applied without dropping rows.
update public.itineraries
set settings = jsonb_build_object(
  'startTime', '09:00',
  'endTime', '21:00',
  'transportMode', 'driving'
)
where settings is null;

-- Tighten: settings must always be present.
alter table public.itineraries
alter column settings set not null;

-- Drop the now-redundant "settings is null or (...)" branch.
alter table public.itineraries
drop constraint itineraries_settings_valid;

alter table public.itineraries
add constraint itineraries_settings_valid
check (
  settings ? 'startTime'
  and settings ? 'endTime'
  and settings ? 'transportMode'
  and (settings->>'startTime') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  and (settings->>'endTime') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  and (settings->>'startTime') < (settings->>'endTime')
  and (settings->>'transportMode') in ('driving', 'walking', 'transit', 'bicycling')
);
