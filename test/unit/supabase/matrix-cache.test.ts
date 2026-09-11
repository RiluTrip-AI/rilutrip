import { describe, it, expect } from "vitest";
import {
  coordKey,
  parseOrderedCoords,
  serializeOrderedCoords,
  subsetMatrixByCoords,
} from "@/supabase/functions/optimize-route/matrix-cache";

describe("matrix-cache helpers", () => {
  describe("serializeOrderedCoords / parseOrderedCoords", () => {
    it("serializes coordinates in order, rounded to 6 decimals, without sorting", () => {
      const serialized = serializeOrderedCoords([
        { lat: 25.1234567, lng: 121.5 },
        { lat: 24.0, lng: 120.999999 },
      ]);
      expect(serialized).toBe("25.123457,121.500000;24.000000,120.999999");
    });

    it("round-trips through parseOrderedCoords", () => {
      const points = [
        { lat: 25.01, lng: 121.02 },
        { lat: 25.03, lng: 121.04 },
      ];
      expect(parseOrderedCoords(serializeOrderedCoords(points))).toEqual([
        coordKey(25.01, 121.02),
        coordKey(25.03, 121.04),
      ]);
    });

    it("preserves order (does not sort)", () => {
      const forward = serializeOrderedCoords([
        { lat: 2, lng: 2 },
        { lat: 1, lng: 1 },
      ]);
      const reversed = serializeOrderedCoords([
        { lat: 1, lng: 1 },
        { lat: 2, lng: 2 },
      ]);
      expect(forward).not.toBe(reversed);
    });
  });

  describe("subsetMatrixByCoords", () => {
    // Stand-in coordinate keys in matrix-row order.
    const cachedCoords = ["A", "B", "C", "D"];
    const matrix = [
      [0, 4, 2, 6],
      [4, 0, 5, 9],
      [2, 5, 0, 4],
      [6, 9, 4, 0],
    ];

    it("returns the full matrix when coords match in the same order", () => {
      expect(subsetMatrixByCoords(matrix, cachedCoords, ["A", "B", "C", "D"])).toEqual(matrix);
    });

    it("remaps correctly when coords are reordered", () => {
      // desired [B, A] -> cached positions [1, 0]; result[i][j] = matrix[idx[i]][idx[j]]
      expect(subsetMatrixByCoords(matrix, cachedCoords, ["B", "A"])).toEqual([
        [0, 4],
        [4, 0],
      ]);
      // desired [D, C] -> positions [3, 2]
      expect(subsetMatrixByCoords(matrix, cachedCoords, ["D", "C"])).toEqual([
        [0, 4],
        [4, 0],
      ]);
    });

    it("extracts a sub-matrix when activities are deleted (subset)", () => {
      // keep [A, C, D] -> positions [0, 2, 3]
      expect(subsetMatrixByCoords(matrix, cachedCoords, ["A", "C", "D"])).toEqual([
        [0, 2, 6],
        [2, 0, 4],
        [6, 4, 0],
      ]);
    });

    it("returns null (miss) when a desired coordinate is not cached (moved pin)", () => {
      expect(subsetMatrixByCoords(matrix, cachedCoords, ["A", "B", "X"])).toBeNull();
    });

    it("returns null (miss) when a new coordinate is added", () => {
      expect(subsetMatrixByCoords(matrix, cachedCoords, ["A", "B", "C", "D", "E"])).toBeNull();
    });

    it("matches duplicate coordinates one-to-one (consuming positions)", () => {
      const dupMatrix = [
        [0, 3],
        [3, 0],
      ];
      const dupCoords = ["A", "A"];
      expect(subsetMatrixByCoords(dupMatrix, dupCoords, ["A", "A"])).toEqual(dupMatrix);
      // three "A" desired but only two cached -> miss
      expect(subsetMatrixByCoords(dupMatrix, dupCoords, ["A", "A", "A"])).toBeNull();
    });

    it("returns null when the cache is structurally inconsistent", () => {
      // cachedCoords length does not match matrix size
      expect(subsetMatrixByCoords(matrix, ["A", "B"], ["A", "B"])).toBeNull();
    });
  });
});
