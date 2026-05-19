/**
 * Place Resolver Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolvePlaceDetails } from "@/lib/places/place-resolver";

// Mock Supabase client
vi.mock("@/lib/supabase/client", () => ({
  getAccessToken: vi.fn().mockResolvedValue("mock-token"),
}));

// Mock Fetch
const mockFetch = vi.fn();

beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockClear();
});

describe("resolvePlaceDetails", () => {
  it("returns success status with full place details", async () => {
    mockFetch.mockImplementationOnce(async (_url, options) => {
      const body = JSON.parse(options.body);
      const reqId = body.places[0].id;
      return {
        ok: true,
        json: async () => ({
          resolved: [
            {
              id: reqId,
              name: "Tokyo Tower",
              lat: 35.6586,
              lng: 139.7454,
              place_id: "ChIJCewJkL2LGGAR3Qmk0vCTGkg",
              rating: 4.5,
              user_ratings_total: 1200,
              opening_hours: { periods: [] },
              website: "https://www.tokyotower.co.jp",
            },
          ],
        }),
      };
    });

    const result = await resolvePlaceDetails({ name: "Tokyo Tower" });

    expect(result.status).toBe("success");
    expect(result.location.name).toBe("Tokyo Tower");
    expect(result.location.lat).toBe(35.6586);
    expect(result.location.lng).toBe(139.7454);
    expect(result.location.place_id).toBe("ChIJCewJkL2LGGAR3Qmk0vCTGkg");
    expect(result.location.rating).toBe(4.5);
    expect(result.location.user_ratings_total).toBe(1200);
    expect(result.location.opening_hours).toEqual({ periods: [] });
    expect(result.location.website).toBe("https://www.tokyotower.co.jp");
  });

  it("returns not_found status when API returns NOT_FOUND", async () => {
    mockFetch.mockImplementationOnce(async (_url, options) => {
      const body = JSON.parse(options.body);
      const reqId = body.places[0].id;
      return {
        ok: true,
        json: async () => ({
          resolved: [{ id: reqId, name: "Nonexistent", error: "NOT_FOUND" }],
        }),
      };
    });

    const result = await resolvePlaceDetails({ name: "Nonexistent" });

    expect(result.status).toBe("not_found");
    expect(result.location.lat).toBeUndefined();
    expect(result.location.lng).toBeUndefined();
  });

  it("returns error status on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await resolvePlaceDetails({ name: "Unknown Place" });

    expect(result.status).toBe("error");
    expect(result.location.name).toBe("Unknown Place");
    expect(result.location.lat).toBeUndefined();
    expect(result.location.lng).toBeUndefined();
  });

  it("returns error status when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await resolvePlaceDetails({ name: "Offline Place" });

    expect(result.status).toBe("error");
    expect(result.location.name).toBe("Offline Place");
    expect(result.location.lat).toBeUndefined();
    expect(result.location.lng).toBeUndefined();
  });

  it("preserves existing coordinates on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const result = await resolvePlaceDetails({
      name: "Known Place",
      lat: 25.033,
      lng: 121.5654,
    });

    expect(result.status).toBe("error");
    expect(result.location.lat).toBe(25.033);
    expect(result.location.lng).toBe(121.5654);
  });
});
