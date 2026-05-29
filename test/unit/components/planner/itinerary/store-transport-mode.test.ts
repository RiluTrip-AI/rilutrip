import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Itinerary } from "@/types/itinerary";

const mocks = vi.hoisted(() => ({
  updateItinerary: vi.fn(),
}));

vi.mock("@/lib/supabase/itineraries", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/itineraries")>(
    "@/lib/supabase/itineraries",
  );
  return { ...actual, updateItinerary: mocks.updateItinerary };
});

vi.mock("@/lib/supabase/shares", () => ({
  getEffectivePermission: vi.fn().mockResolvedValue({ permission: "owner", source: "owner" }),
}));

vi.mock("@/lib/ai/client", () => ({
  aiClient: { streamItinerary: vi.fn(), chat: vi.fn() },
}));

vi.mock("@/lib/places/resolution-service", () => ({
  resolvePlaceDetails: vi.fn(),
}));

import { useItineraryStore } from "@/components/planner/itinerary/store";

const baseItinerary: Itinerary = {
  id: "itin-1",
  user_id: "u1",
  title: "Test Trip",
  destination: "Tokyo",
  start_date: "2026-05-01",
  end_date: "2026-05-03",
  description: undefined,
  days: [
    { day_number: 1, activities: [], transport_mode: "driving" },
    { day_number: 2, activities: [] },
    { day_number: 3, activities: [] },
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
    historyPast: [],
    historyFuture: [],
    isGenerating: false,
  });
}

describe("store - setDayTransportMode", () => {
  beforeEach(() => {
    mocks.updateItinerary.mockReset();
    mocks.updateItinerary.mockImplementation((_id: string, updates: Partial<Itinerary>) =>
      Promise.resolve({ ...baseItinerary, ...updates }),
    );
  });

  it("updates transport_mode for the specified day", async () => {
    setupStore();
    await useItineraryStore.getState().setDayTransportMode(1, "walking");
    const day1 = useItineraryStore.getState().itinerary!.days.find((d) => d.day_number === 1)!;
    expect(day1.transport_mode).toBe("walking");
  });

  it("does not affect other days", async () => {
    setupStore();
    await useItineraryStore.getState().setDayTransportMode(1, "transit");
    const day2 = useItineraryStore.getState().itinerary!.days.find((d) => d.day_number === 2)!;
    expect(day2.transport_mode).toBeUndefined();
  });

  it("calls updateItinerary once with the updated days", async () => {
    setupStore();
    await useItineraryStore.getState().setDayTransportMode(2, "bicycling");
    expect(mocks.updateItinerary).toHaveBeenCalledOnce();
    const calledDays: { day_number: number; transport_mode?: string }[] =
      mocks.updateItinerary.mock.calls[0][1].days;
    const day2 = calledDays.find((d) => d.day_number === 2)!;
    expect(day2.transport_mode).toBe("bicycling");
  });

  it("can overwrite an existing transport_mode", async () => {
    setupStore();
    await useItineraryStore.getState().setDayTransportMode(1, "bicycling");
    const day1 = useItineraryStore.getState().itinerary!.days.find((d) => d.day_number === 1)!;
    expect(day1.transport_mode).toBe("bicycling");
  });

  it("does nothing when itinerary is null", async () => {
    useItineraryStore.setState({ itinerary: null });
    await useItineraryStore.getState().setDayTransportMode(1, "driving");
    expect(mocks.updateItinerary).not.toHaveBeenCalled();
  });

  it("skips save when mode is already set to the same value", async () => {
    setupStore();
    await useItineraryStore.getState().setDayTransportMode(1, "driving");
    expect(mocks.updateItinerary).not.toHaveBeenCalled();
  });
});

describe("store - setAllDaysTransportMode", () => {
  beforeEach(() => {
    mocks.updateItinerary.mockReset();
    mocks.updateItinerary.mockImplementation((_id: string, updates: Partial<Itinerary>) =>
      Promise.resolve({ ...baseItinerary, ...updates }),
    );
  });

  it("applies transport_mode to every day", async () => {
    setupStore();
    await useItineraryStore.getState().setAllDaysTransportMode("walking");
    const days = useItineraryStore.getState().itinerary!.days;
    days.forEach((day) => {
      expect(day.transport_mode).toBe("walking");
    });
  });

  it("calls updateItinerary exactly once", async () => {
    setupStore();
    await useItineraryStore.getState().setAllDaysTransportMode("transit");
    expect(mocks.updateItinerary).toHaveBeenCalledOnce();
  });

  it("overwrites existing transport_mode on all days", async () => {
    setupStore();
    await useItineraryStore.getState().setAllDaysTransportMode("bicycling");
    const days = useItineraryStore.getState().itinerary!.days;
    days.forEach((day) => {
      expect(day.transport_mode).toBe("bicycling");
    });
  });

  it("does nothing when itinerary is null", async () => {
    useItineraryStore.setState({ itinerary: null });
    await useItineraryStore.getState().setAllDaysTransportMode("driving");
    expect(mocks.updateItinerary).not.toHaveBeenCalled();
  });
});
