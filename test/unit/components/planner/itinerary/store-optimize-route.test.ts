import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Itinerary, Activity } from "@/types/itinerary";

const mocks = vi.hoisted(() => ({
  updateItinerary: vi.fn(),
  loadItinerary: vi.fn(),
  getAccessToken: vi.fn(),
  streamItinerary: vi.fn(),
}));

vi.mock("@/lib/supabase/itineraries", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/itineraries")>(
    "@/lib/supabase/itineraries",
  );
  return { ...actual, loadItinerary: mocks.loadItinerary, updateItinerary: mocks.updateItinerary };
});

vi.mock("@/lib/supabase/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/supabase/client")>("@/lib/supabase/client");
  return { ...actual, getAccessToken: mocks.getAccessToken };
});

vi.mock("@/lib/supabase/shares", () => ({
  getEffectivePermission: vi.fn().mockResolvedValue({ permission: "owner", source: "owner" }),
}));

vi.mock("@/lib/supabase/day-matrices", () => ({
  deleteDayMatrix: vi.fn(),
  loadAllDayMatrices: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/ai/client", () => ({
  aiClient: { streamItinerary: mocks.streamItinerary, chat: vi.fn() },
}));

vi.mock("@/lib/places/place-resolver", () => ({
  resolvePlaceDetails: vi.fn(),
}));

import { useItineraryStore, OptimizeError } from "@/components/planner/itinerary/store";

const makeActivity = (id: string, order: number, time: string): Activity => ({
  id,
  title: `Activity ${id}`,
  note: "",
  time,
  duration_minutes: 60,
  order,
  location: { name: `Place ${id}`, lat: 25.0 + order * 0.01, lng: 121.5 + order * 0.01 },
});

const baseItinerary: Itinerary = {
  id: "itin-1",
  user_id: "u1",
  title: "Test Trip",
  destination: "Tokyo",
  start_date: "2026-05-01",
  end_date: "2026-05-02",
  preferences: undefined,
  settings: {
    startTime: "09:00",
    endTime: "21:00",
    transportMode: "driving",
  },
  days: [
    {
      day_number: 1,
      transport_mode: "walking",
      start_time: "09:00",
      end_time: "21:00",
      activities: [makeActivity("act-a", 0, "09:00"), makeActivity("act-b", 1, "10:00")],
    },
    {
      day_number: 2,
      transport_mode: "driving",
      start_time: "09:00",
      end_time: "21:00",
      activities: [makeActivity("act-c", 0, "09:00")],
    },
  ],
  status: "completed",
  link_access: "none",
  created_at: "2026-04-16T00:00:00Z",
  updated_at: "2026-04-16T00:00:00Z",
};

function setupStore(itinerary: Itinerary = baseItinerary) {
  useItineraryStore.setState({
    itinerary,
    access: { permission: "owner", source: "owner" },
    isSaving: false,
    saveError: false,
    errorKind: null,
    errorCode: null,
    optimizingDays: new Set<number>(),
    dayMatrices: new Map(),
    optimizeWarnings: new Map(),
    historyPast: [],
    historyFuture: [],
    isGenerating: false,
  });
}

function mockFetchSuccess(response: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => response,
    }),
  );
}

function mockFetchFailure() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
}

describe("store - optimizeDayRoutes", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    mocks.loadItinerary.mockReset();
    mocks.loadItinerary.mockResolvedValue(baseItinerary);
    mocks.updateItinerary.mockReset();
    mocks.updateItinerary.mockImplementation((_id: string, updates: Partial<Itinerary>) =>
      Promise.resolve({ ...baseItinerary, ...updates }),
    );
    mocks.getAccessToken.mockReset();
    mocks.getAccessToken.mockResolvedValue("fake-token");
    mocks.streamItinerary.mockReset();
    mocks.streamItinerary.mockImplementation(
      async (
        _itineraryId: string,
        _locale: string,
        _onActivity: unknown,
        onComplete: () => void,
      ) => {
        onComplete();
      },
    );
  });

  it("does nothing when itinerary is null", async () => {
    useItineraryStore.setState({ itinerary: null });
    await useItineraryStore.getState().optimizeDayRoutes();
    expect(mocks.updateItinerary).not.toHaveBeenCalled();
  });

  it("does nothing when no day has 2+ activities", async () => {
    const single: Itinerary = {
      ...baseItinerary,
      days: [
        {
          day_number: 1,
          transport_mode: "driving",
          start_time: "09:00",
          end_time: "21:00",
          activities: [makeActivity("only", 0, "09:00")],
        },
      ],
    };
    setupStore(single);
    await useItineraryStore.getState().optimizeDayRoutes();
    expect(mocks.updateItinerary).not.toHaveBeenCalled();
  });

  it("adds day to optimizingDays while running, removes when done", async () => {
    setupStore();
    const dayNumberSets: number[][] = [];
    const unsubscribe = useItineraryStore.subscribe((s) =>
      dayNumberSets.push([...s.optimizingDays]),
    );

    mockFetchSuccess({
      days: [
        {
          dayNumber: 1,
          activities: [
            { id: "act-a", time: "09:00", order: 0 },
            { id: "act-b", time: "10:15", order: 1 },
          ],
        },
      ],
    });

    await useItineraryStore.getState().optimizeDayRoutes();
    unsubscribe();

    expect(dayNumberSets.some((s) => s.includes(1))).toBe(true);
    expect(useItineraryStore.getState().optimizingDays.size).toBe(0);
  });

  it("sends only days with 2+ activities to the API", async () => {
    setupStore();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ days: [{ dayNumber: 1, activities: [] }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await useItineraryStore.getState().optimizeDayRoutes();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // day 2 has only 1 activity ??should be excluded
    expect(body.days.map((d: { dayNumber: number }) => d.dayNumber)).toEqual([1]);
  });

  it("includes Authorization header with access token", async () => {
    setupStore();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ days: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await useItineraryStore.getState().optimizeDayRoutes();

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer fake-token");
  });

  it("calls the Supabase Edge Function endpoint for route optimization", async () => {
    setupStore();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ days: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await useItineraryStore.getState().optimizeDayRoutes();

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://project.supabase.co/functions/v1/optimize-route",
    );
  });

  it("sends the itinerary id and leaves matrix reuse to the server", async () => {
    setupStore();
    useItineraryStore.setState({
      dayMatrices: new Map([
        [
          1,
          {
            activityIds: ["act-a", "act-b"],
            matrix: [
              [0, 7],
              [7, 0],
            ],
            transportMode: "walking",
            locationFingerprint: "fp-walking",
            matrixSource: "google_routes_matrix",
          },
        ],
      ]),
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ days: [{ dayNumber: 1, activities: [] }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await useItineraryStore.getState().optimizeDayRoutes();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const day = body.days.find((d: { dayNumber: number }) => d.dayNumber === 1);
    expect(body.itineraryId).toBe("itin-1");
    expect(day.precomputedMatrix).toBeUndefined();
    expect(day.matrixActivityIds).toBeUndefined();
  });

  it("updates activity times and order in the store when API succeeds", async () => {
    setupStore();
    mockFetchSuccess({
      days: [
        {
          dayNumber: 1,
          activities: [
            { id: "act-b", time: "09:00", order: 0 },
            { id: "act-a", time: "10:15", order: 1 },
          ],
        },
      ],
    });

    await useItineraryStore.getState().optimizeDayRoutes();

    const day1 = useItineraryStore.getState().itinerary!.days.find((d) => d.day_number === 1)!;
    // act-b should now be first (order 0) with time 09:00
    expect(day1.activities[0].id).toBe("act-b");
    expect(day1.activities[0].time).toBe("09:00");
    expect(day1.activities[0].order).toBe(0);
    // act-a should be second (order 1)
    expect(day1.activities[1].id).toBe("act-a");
    expect(day1.activities[1].time).toBe("10:15");
    expect(day1.activities[1].order).toBe(1);
  });

  it("calls updateItinerary once to persist the optimised order", async () => {
    setupStore();
    mockFetchSuccess({
      days: [
        {
          dayNumber: 1,
          activities: [
            { id: "act-a", time: "09:00", order: 0 },
            { id: "act-b", time: "10:15", order: 1 },
          ],
        },
      ],
    });

    await useItineraryStore.getState().optimizeDayRoutes();
    expect(mocks.updateItinerary).toHaveBeenCalledOnce();
  });

  it("stores returned matrices locally after successful optimization", async () => {
    setupStore();
    mockFetchSuccess({
      days: [
        {
          dayNumber: 1,
          activities: [
            { id: "act-a", time: "09:00", order: 0 },
            { id: "act-b", time: "10:15", order: 1 },
          ],
          matrixActivityIds: ["act-a", "act-b"],
          matrix: [
            [0, 11],
            [11, 0],
          ],
          transportMode: "walking",
          locationFingerprint: "fp-returned",
          matrixSource: "google_routes_matrix",
        },
      ],
    });

    await useItineraryStore.getState().optimizeDayRoutes();

    expect(useItineraryStore.getState().dayMatrices.get(1)).toEqual({
      activityIds: ["act-a", "act-b"],
      matrix: [
        [0, 11],
        [11, 0],
      ],
      transportMode: "walking",
      locationFingerprint: "fp-returned",
      matrixSource: "google_routes_matrix",
    });
  });

  it("stores route optimization warnings returned by the API", async () => {
    setupStore();
    mockFetchSuccess({
      days: [
        {
          dayNumber: 1,
          activities: [
            { id: "act-a", time: "09:00", order: 0 },
            { id: "act-b", time: "10:15", order: 1 },
          ],
          warnings: [
            {
              code: "ACTIVITY_WINDOW_TOO_SHORT",
              dayNumber: 1,
              activityId: "act-a",
              title: "Activity act-a",
              openingHours: { open: "09:00", close: "09:30" },
              durationMinutes: 60,
              availableMinutes: 30,
            },
          ],
        },
      ],
      warnings: [
        {
          code: "ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS",
          dayNumber: 1,
          activityId: "act-a",
          title: "Activity act-a",
          durationMinutes: 60,
          reason: "DAY_END",
          dayEndTime: "21:00",
        },
      ],
    });

    await useItineraryStore.getState().optimizeDayRoutes();

    expect(useItineraryStore.getState().optimizeWarnings.get("act-a")).toMatchObject({
      code: "ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS",
      activityId: "act-a",
      durationMinutes: 60,
      reason: "DAY_END",
      dayEndTime: "21:00",
    });
    expect(useItineraryStore.getState().itinerary?.days[0].optimization_warnings).toEqual([
      expect.objectContaining({
        code: "ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS",
        activityId: "act-a",
      }),
    ]);
    expect(mocks.updateItinerary.mock.calls[0]?.[1].days[0].optimization_warnings).toEqual([
      expect.objectContaining({
        code: "ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS",
        activityId: "act-a",
      }),
    ]);
  });

  it("hydrates route optimization warnings from a loaded itinerary", async () => {
    const loaded = {
      ...baseItinerary,
      days: [
        {
          ...baseItinerary.days[0],
          optimization_warnings: [
            {
              code: "ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS" as const,
              dayNumber: 1,
              activityId: "act-b",
              title: "Activity act-b",
              durationMinutes: 60,
              reason: "DAY_END" as const,
              dayEndTime: "21:00",
            },
          ],
        },
        baseItinerary.days[1],
      ],
    };
    mocks.loadItinerary.mockResolvedValueOnce(loaded);

    await useItineraryStore.getState().fetchItinerary(baseItinerary.id);

    expect(useItineraryStore.getState().optimizeWarnings.get("act-b")).toMatchObject({
      code: "ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS",
      activityId: "act-b",
      reason: "DAY_END",
    });
  });

  it("does not store a returned matrix without an explicit matrixSource", async () => {
    setupStore();
    mockFetchSuccess({
      days: [
        {
          dayNumber: 1,
          activities: [
            { id: "act-a", time: "09:00", order: 0 },
            { id: "act-b", time: "10:15", order: 1 },
          ],
          matrixActivityIds: ["act-a", "act-b"],
          matrix: [
            [0, 11],
            [11, 0],
          ],
          transportMode: "walking",
        },
      ],
    });

    await useItineraryStore.getState().optimizeDayRoutes();

    expect(useItineraryStore.getState().dayMatrices.has(1)).toBe(false);
  });

  it("does not update store when API returns a non-OK response", async () => {
    setupStore();
    mockFetchFailure();
    const original = useItineraryStore.getState().itinerary!.days[0].activities.map((a) => a.id);

    await expect(useItineraryStore.getState().optimizeDayRoutes()).rejects.toBeInstanceOf(
      OptimizeError,
    );

    const after = useItineraryStore.getState().itinerary!.days[0].activities.map((a) => a.id);
    expect(after).toEqual(original);
    expect(mocks.updateItinerary).not.toHaveBeenCalled();
  });

  it("clears optimizingDays after API failure", async () => {
    setupStore();
    mockFetchFailure();
    await expect(useItineraryStore.getState().optimizeDayRoutes()).rejects.toBeInstanceOf(
      OptimizeError,
    );
    expect(useItineraryStore.getState().optimizingDays.size).toBe(0);
  });

  it("throws OptimizeError(INSUFFICIENT_CREDITS) on 402 response", async () => {
    setupStore();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({}) }),
    );
    await expect(useItineraryStore.getState().optimizeDayRoutes()).rejects.toMatchObject({
      kind: "INSUFFICIENT_CREDITS",
    });
  });

  it("throws OptimizeError(GENERIC) on other non-OK responses", async () => {
    setupStore();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );
    await expect(useItineraryStore.getState().optimizeDayRoutes()).rejects.toMatchObject({
      kind: "GENERIC",
    });
  });

  it("throws OptimizeError(GENERIC) when fetch itself rejects", async () => {
    setupStore();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(useItineraryStore.getState().optimizeDayRoutes()).rejects.toMatchObject({
      kind: "GENERIC",
    });
  });

  it("does not automatically call optimize-route after generation completes", async () => {
    setupStore({ ...baseItinerary, status: "draft" });
    const originalOptimizeDayRoutes = useItineraryStore.getState().optimizeDayRoutes;
    const optimizeSpy = vi.fn().mockResolvedValue(undefined);
    useItineraryStore.setState({ optimizeDayRoutes: optimizeSpy });

    try {
      await useItineraryStore.getState().startGeneration("itin-1", "en");
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      useItineraryStore.setState({ optimizeDayRoutes: originalOptimizeDayRoutes });
    }

    expect(optimizeSpy).not.toHaveBeenCalled();
  });

  it("does not alter days that the API did not return", async () => {
    setupStore();
    mockFetchSuccess({
      days: [
        {
          dayNumber: 1,
          activities: [
            { id: "act-a", time: "09:00", order: 0 },
            { id: "act-b", time: "10:00", order: 1 },
          ],
        },
        // day 2 is intentionally omitted
      ],
    });

    await useItineraryStore.getState().optimizeDayRoutes();

    const day2 = useItineraryStore.getState().itinerary!.days.find((d) => d.day_number === 2)!;
    expect(day2.activities[0].id).toBe("act-c");
  });

  // optimizeDayRoutes per-day filtering

  it("only sends specified day numbers to the API when dayNumbers is provided", async () => {
    setupStore();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ days: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await useItineraryStore.getState().optimizeDayRoutes([1]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.days.map((d: { dayNumber: number }) => d.dayNumber)).toEqual([1]);
  });

  it("does nothing when the specified day has fewer than 2 activities", async () => {
    setupStore();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await useItineraryStore.getState().optimizeDayRoutes([2]);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
