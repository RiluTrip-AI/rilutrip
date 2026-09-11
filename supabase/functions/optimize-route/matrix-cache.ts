// Pure helpers for the day_matrices travel-time cache.
//
// Cache validity is COORDINATE-based: a travel-time matrix is fully determined
// by the ordered list of coordinates (plus transport mode), so reuse is keyed on
// coordinates, not activity ids. This makes "edit a place's location" correctly
// invalidate the cache (the moved coordinate is no longer present), while still
// allowing reuse when activities are deleted or reordered (the remaining
// coordinates are still a sub-multiset of the cached ones).
//
// The cache stores the ordered coordinate string directly (no hashing) so it is
// human-readable and can be diffed element by element.

export function normalizeCoordinate(value: number | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(6) : null;
}

/** Stable "lat,lng" key for one point, rounded to 6 decimals. */
export function coordKey(lat: number | undefined, lng: number | undefined): string {
  return `${normalizeCoordinate(lat)},${normalizeCoordinate(lng)}`;
}

/**
 * Ordered "lat,lng;lat,lng;..." string, in the SAME order as the matrix rows.
 * Order matters and is preserved (no sorting): position i of this string must
 * correspond to row/column i of the matrix it is stored with.
 */
export function serializeOrderedCoords(
  points: Array<{ lat: number | undefined; lng: number | undefined }>,
): string {
  return points.map((p) => coordKey(p.lat, p.lng)).join(";");
}

export function parseOrderedCoords(serialized: string): string[] {
  return serialized.length === 0 ? [] : serialized.split(";");
}

/**
 * Reuse a cached matrix for the desired ordered coordinates.
 *
 * Maps each desired coordinate to a not-yet-consumed cached position (so
 * duplicate identical coordinates are matched one-to-one), then remaps the
 * matrix: result[a][b] = matrix[index(a)][index(b)]. This keeps the proven
 * sub-matrix maths while changing only the lookup key from id to coordinate.
 *
 * Returns null (cache miss) when any desired coordinate is absent from the
 * cache, or when the cache is structurally inconsistent.
 */
export function subsetMatrixByCoords(
  matrix: number[][],
  cachedCoords: string[],
  desiredCoords: string[],
): number[][] | null {
  if (cachedCoords.length !== matrix.length) return null;

  const used = new Array(cachedCoords.length).fill(false);
  const indices: number[] = [];
  for (const coord of desiredCoords) {
    let found = -1;
    for (let i = 0; i < cachedCoords.length; i++) {
      if (!used[i] && cachedCoords[i] === coord) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;
    used[found] = true;
    indices.push(found);
  }

  return indices.map((row) => indices.map((col) => matrix[row][col]));
}
