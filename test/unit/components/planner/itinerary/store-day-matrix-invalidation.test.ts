import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Itinerary, Activity } from "@/types/itinerary";

const mocks = vi.hoisted(() => ({
  updateItinerary: vi.fn(),
  deleteDayMatrix: vi.fn(),
  resolvePlaceDetails: vi.fn(),
}));

vi.mock("@/lib/supabase/itineraries", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/itineraries")>(
    "@/lib/supabase/itineraries",
  );
  return { ...actual, updateItinerary: mocks.updateItinerary };
});

vi.mock("@/lib/supabase/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/supabase/client")>("@/lib/supabase/client");
  return { ...actual, getAccessToken: vi.fn() };
});

vi.mock("@/lib/supabase/day-matrices", () => ({
  deleteDayMatrix: mocks.deleteDayMatrix,
  loadAllDayMatrices: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/supabase/shares", () => ({
  getEffectivePermission: vi.fn().mockResolvedValue({ permission: "owner", source: "owner" }),
}));

vi.mock("@/lib/ai/client", () => ({
  aiClient: { streamItinerary: vi.fn(), chat: vi.fn() },
}));

vi.mock("@/lib/places/place-resolver", () => ({
  resolvePlaceDetails: mocks.resolvePlaceDetails,
}));

import { useItineraryStore } from "@/components/planner/itinerary/store";

const makeActivity = (id: string, order: number): Activity => ({
  id,
  title: `Activity ${id}`,
  note: "",
  time: "09:00",
  duration_minutes: 60,
  order,
  location: { name: `Place ${id}`, lat: 25.0 + order * 0.01, lng: 121.5 + order * 0.01 },
});

const baseItinerary: Itinerary = {
  id: "itin-1",
  user_id: "u1",
  title: "Test",
  destination: "Tokyo",
  start_date: "2026-05-01",
  end_date: "2026-05-02",
  preferences: undefined,
  settings: {
    startTime: "09:00",
    endTime: "21:00",
    transportMode: "walking",
  },
  days: [
    {
      day_number: 1,
      transport_mode: "walking",
      start_time: "09:00",
      end_time: "21:00",
      activities: [makeActivity("a", 0), makeActivity("b", 1)],
    },
    {
      day_number: 2,
      transport_mode: "driving",
      start_time: "09:00",
      end_time: "21:00",
      activities: [makeActivity("c", 0), makeActivity("d", 1)],
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
    dayMatrices: new Map([
      [
        1,
        {
          activityIds: ["a", "b"],
          matrix: [
            [0, 5],
            [5, 0],
          ],
          transportMode: "walking",
          locationFingerprint: "fp-1",
          matrixSource: "google_routes_matrix",
        },
      ],
      [
        2,
        {
          activityIds: ["c", "d"],
          matrix: [
            [0, 9],
            [9, 0],
          ],
          transportMode: "driving",
          locationFingerprint: "fp-2",
          matrixSource: "google_routes_matrix",
        },
      ],
    ]),
    isSaving: false,
    saveError: false,
    historyPast: [],
    historyFuture: [],
  });
}

describe("store - day matrix invalidation", () => {
  beforeEach(() => {
    mocks.deleteDayMatrix.mockReset().mockResolvedValue(undefined);
    mocks.updateItinerary.mockReset();
    mocks.updateItinerary.mockImplementation((_id: string, updates: Partial<Itinerary>) =>
      Promise.resolve({ ...baseItinerary, ...updates }),
    );
    mocks.resolvePlaceDetails.mockReset();
    vi.unstubAllGlobals();
  });

  it("invalidates local and persisted matrix without calling distance-matrix", async () => {
    setupStore();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await useItineraryStore.getState().invalidateDayMatrix(1);

    expect(useItineraryStore.getState().dayMatrices.has(1)).toBe(false);
    expect(mocks.deleteDayMatrix).toHaveBeenCalledWith("itin-1", 1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits for persisted matrix deletion before resolving invalidation", async () => {
    setupStore();
    let deleteResolved = false;
    let resolveDelete!: () => void;
    mocks.deleteDayMatrix.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = () => {
          deleteResolved = true;
          resolve();
        };
      }),
    );

    const invalidate = useItineraryStore.getState().invalidateDayMatrix(1);
    await Promise.resolve();

    expect(deleteResolved).toBe(false);
    expect(mocks.deleteDayMatrix).toHaveBeenCalledWith("itin-1", 1);

    resolveDelete();
    await invalidate;

    expect(deleteResolved).toBe(true);
  });

  it("does not restore the local matrix when persisted deletion fails", async () => {
    setupStore();
    mocks.deleteDayMatrix.mockRejectedValue(new Error("RLS denied"));

    await useItineraryStore.getState().invalidateDayMatrix(1);

    expect(useItineraryStore.getState().dayMatrices.has(1)).toBe(false);
  });

  it("invalidates a day matrix after adding an activity", async () => {
    setupStore();
    mocks.resolvePlaceDetails.mockResolvedValue({
      name: "New Place",
      lat: 25.2,
      lng: 121.7,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await useItineraryStore.getState().addActivity(1, {
      title: "New Activity",
      locationName: "New Place",
      time: "13:00",
      duration: 60,
      note: "",
    });

    expect(useItineraryStore.getState().dayMatrices.has(1)).toBe(false);
    expect(mocks.deleteDayMatrix).toHaveBeenCalledWith("itin-1", 1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invalidates a day matrix after changing an activity location", async () => {
    setupStore();
    mocks.resolvePlaceDetails.mockResolvedValue({
      name: "Moved Place",
      lat: 25.2,
      lng: 121.7,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await useItineraryStore.getState().updateActivity("a", {
      title: "Activity a",
      locationName: "Moved Place",
      time: "09:00",
      duration: 60,
      note: "",
    });

    expect(useItineraryStore.getState().dayMatrices.has(1)).toBe(false);
    expect(mocks.deleteDayMatrix).toHaveBeenCalledWith("itin-1", 1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a day matrix after deleting an activity so remaining activity pairs can use the cached subset", async () => {
    setupStore();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await useItineraryStore.getState().deleteActivity("a");

    expect(useItineraryStore.getState().dayMatrices.has(1)).toBe(true);
    expect(mocks.deleteDayMatrix).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a day matrix after same-day reordering so travel minutes can be read in the new order", async () => {
    setupStore();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const reordered: Itinerary = {
      ...baseItinerary,
      days: baseItinerary.days.map((day) =>
        day.day_number === 1 ? { ...day, activities: [day.activities[1], day.activities[0]] } : day,
      ),
    };

    useItineraryStore.setState({
      previewBaseItinerary: baseItinerary,
      previewItinerary: reordered,
    });

    await useItineraryStore.getState().applyPreview();

    expect(useItineraryStore.getState().dayMatrices.has(1)).toBe(true);
    expect(mocks.deleteDayMatrix).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invalidates one day after changing its transport mode", async () => {
    setupStore();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await useItineraryStore.getState().setDayTransportMode(1, "driving");

    expect(useItineraryStore.getState().dayMatrices.has(1)).toBe(false);
    expect(useItineraryStore.getState().dayMatrices.has(2)).toBe(true);
    expect(mocks.deleteDayMatrix).toHaveBeenCalledWith("itin-1", 1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invalidates every day after applying a transport mode to all days", async () => {
    setupStore();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await useItineraryStore.getState().setAllDaysTransportMode("transit");

    expect(useItineraryStore.getState().dayMatrices.size).toBe(0);
    expect(mocks.deleteDayMatrix).toHaveBeenCalledWith("itin-1", 1);
    expect(mocks.deleteDayMatrix).toHaveBeenCalledWith("itin-1", 2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
