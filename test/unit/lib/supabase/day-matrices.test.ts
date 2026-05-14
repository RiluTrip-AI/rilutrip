import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  delete: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      expect(table).toBe("day_matrices");
      return {
        upsert: mocks.upsert,
        delete: mocks.delete,
      };
    },
  },
}));

import * as dayMatrices from "@/lib/supabase/day-matrices";

describe("day matrix client writes", () => {
  beforeEach(() => {
    mocks.upsert.mockReset();
    mocks.delete.mockReset();
    mocks.eq.mockReset();
    mocks.delete.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({ eq: mocks.eq });
  });

  it("does not expose a client-side save helper", () => {
    expect(dayMatrices).not.toHaveProperty("saveDayMatrix");
  });
});

describe("deleteDayMatrix", () => {
  beforeEach(() => {
    mocks.delete.mockReset();
    mocks.eq.mockReset();
    mocks.delete.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({ eq: mocks.eq });
  });

  it("deletes the matching itinerary/day row", async () => {
    mocks.eq.mockReturnValueOnce({ eq: mocks.eq }).mockResolvedValueOnce({ error: null });

    await dayMatrices.deleteDayMatrix("itinerary-1", 2);

    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.eq).toHaveBeenNthCalledWith(1, "itinerary_id", "itinerary-1");
    expect(mocks.eq).toHaveBeenNthCalledWith(2, "day_number", 2);
  });

  it("throws when Supabase delete fails", async () => {
    mocks.eq
      .mockReturnValueOnce({ eq: mocks.eq })
      .mockResolvedValueOnce({ error: { message: "RLS denied" } });

    await expect(dayMatrices.deleteDayMatrix("itinerary-1", 2)).rejects.toThrow(
      "Failed to delete day matrix: RLS denied",
    );
  });
});
