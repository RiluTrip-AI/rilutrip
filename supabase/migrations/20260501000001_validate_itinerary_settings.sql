alter table public.itineraries
add constraint itineraries_settings_valid
check (
  settings is null
  or (
    settings ? 'startTime'
    and settings ? 'endTime'
    and settings ? 'transportMode'
    and (settings->>'startTime') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and (settings->>'endTime') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and (settings->>'startTime') < (settings->>'endTime')
    and (settings->>'transportMode') in ('driving', 'walking', 'transit', 'bicycling')
  )
);
