alter table public.day_matrices
add column if not exists location_fingerprint text;

update public.day_matrices
set location_fingerprint = 'legacy:' || id::text
where location_fingerprint is null;

alter table public.day_matrices
alter column location_fingerprint set not null;

alter table public.day_matrices
add column if not exists matrix_source text not null default 'google_routes_matrix';

alter table public.day_matrices
drop constraint if exists day_matrices_source_check;

alter table public.day_matrices
drop constraint if exists day_matrices_matrix_source_check;

alter table public.day_matrices
add constraint day_matrices_matrix_source_check
check (matrix_source in ('google_routes_matrix', 'google_distance_matrix', 'haversine_fallback'));
