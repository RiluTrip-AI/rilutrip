alter table public.day_matrices
drop constraint if exists day_matrices_source_check;

alter table public.day_matrices
drop constraint if exists day_matrices_matrix_source_check;

alter table public.day_matrices
add constraint day_matrices_matrix_source_check
check (matrix_source in ('google_routes_matrix', 'google_distance_matrix', 'haversine_fallback'));
