create table public.day_matrices (
  id uuid primary key default gen_random_uuid(),
  itinerary_id uuid not null references public.itineraries(id) on delete cascade,
  day_number integer not null,
  activity_ids text[] not null,
  matrix jsonb not null,
  transport_mode text not null,
  location_fingerprint text not null,
  matrix_source text not null default 'google_routes_matrix',
  updated_at timestamptz not null default now(),
  unique(itinerary_id, day_number),
  constraint day_matrices_matrix_source_check
    check (matrix_source in ('google_routes_matrix', 'google_distance_matrix', 'haversine_fallback'))
);

alter table public.day_matrices enable row level security;

create policy "Itinerary viewers can read day matrices"
  on public.day_matrices
  for select
  using (
    exists (
      select 1 from public.itineraries
      where id = day_matrices.itinerary_id
        and (
          user_id = auth.uid()
          or link_access in ('view', 'edit')
          or exists (
            select 1 from public.itinerary_shares
            where itinerary_shares.itinerary_id = itineraries.id
              and itinerary_shares.shared_with_email = lower((auth.jwt() ->> 'email'::text))
          )
        )
    )
  );

create policy "Itinerary editors can delete day matrices"
  on public.day_matrices
  for delete
  using (
    exists (
      select 1 from public.itineraries
      where id = day_matrices.itinerary_id
        and (
          user_id = auth.uid()
          or link_access = 'edit'
          or exists (
            select 1 from public.itinerary_shares
            where itinerary_shares.itinerary_id = itineraries.id
              and itinerary_shares.shared_with_email = lower((auth.jwt() ->> 'email'::text))
              and itinerary_shares.permission = 'edit'
          )
        )
    )
  );
