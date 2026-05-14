import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Itinerary, Activity } from "@/types/itinerary";

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
  end_date: "2026-05-03",
  preferences: undefined,
  days: [
    { day_number: 1, activities: [], start_time: "09:00", end_time: "20:00" },
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

describe("store - setDayTimeWindow", () => {
  beforeEach(() => {
    mocks.updateItinerary.mockReset();
    mocks.updateItinerary.mockImplementation((_id: string, updates: Partial<Itinerary>) =>
      Promise.resolve({ ...baseItinerary, ...updates }),
    );
  });

  it("updates start_time and end_time for the specified day", async () => {
    setupStore();
    await useItineraryStore.getState().setDayTimeWindow(1, "08:00", "22:00");
    const day1 = useItineraryStore.getState().itinerary!.days.find((d) => d.day_number === 1)!;
    expect(day1.start_time).toBe("08:00");
    expect(day1.end_time).toBe("22:00");
  });

  it("does not affect other days", async () => {
    setupStore();
    await useItineraryStore.getState().setDayTimeWindow(1, "08:00", "22:00");
    const day2 = useItineraryStore.getState().itinerary!.days.find((d) => d.day_number === 2)!;
    expect(day2.start_time).toBeUndefined();
    expect(day2.end_time).toBeUndefined();
  });

  it("calls updateItinerary once with the updated days", async () => {
    setupStore();
    await useItineraryStore.getState().setDayTimeWindow(2, "10:00", "19:00");
    expect(mocks.updateItinerary).toHaveBeenCalledOnce();
    const calledDays: { day_number: number; start_time?: string; end_time?: string }[] =
      mocks.updateItinerary.mock.calls[0][1].days;
    const day2 = calledDays.find((d) => d.day_number === 2)!;
    expect(day2.start_time).toBe("10:00");
    expect(day2.end_time).toBe("19:00");
  });

  it("does nothing when itinerary is null", async () => {
    useItineraryStore.setState({ itinerary: null });
    await useItineraryStore.getState().setDayTimeWindow(1, "09:00", "20:00");
    expect(mocks.updateItinerary).not.toHaveBeenCalled();
  });
});

describe("store - setAllDaysTimeWindow", () => {
  beforeEach(() => {
    mocks.updateItinerary.mockReset();
    mocks.updateItinerary.mockImplementation((_id: string, updates: Partial<Itinerary>) =>
      Promise.resolve({ ...baseItinerary, ...updates }),
    );
  });

  it("applies start_time and end_time to every day", async () => {
    setupStore();
    await useItineraryStore.getState().setAllDaysTimeWindow("08:00", "21:00");
    const days = useItineraryStore.getState().itinerary!.days;
    days.forEach((day) => {
      expect(day.start_time).toBe("08:00");
      expect(day.end_time).toBe("21:00");
    });
  });

  it("calls updateItinerary exactly once", async () => {
    setupStore();
    await useItineraryStore.getState().setAllDaysTimeWindow("09:00", "20:00");
    expect(mocks.updateItinerary).toHaveBeenCalledOnce();
  });

  it("does nothing when itinerary is null", async () => {
    useItineraryStore.setState({ itinerary: null });
    await useItineraryStore.getState().setAllDaysTimeWindow("09:00", "20:00");
    expect(mocks.updateItinerary).not.toHaveBeenCalled();
  });
});

describe("store - getActivityDurationOverloadedDays", () => {
  beforeEach(() => {
    mocks.updateItinerary.mockReset();
  });

  it("returns empty set when itinerary is null", () => {
    useItineraryStore.setState({ itinerary: null });
    expect(useItineraryStore.getState().getActivityDurationOverloadedDays().size).toBe(0);
  });

  it("returns empty set when no day is overloaded", () => {
    const itinerary: Itinerary = {
      ...baseItinerary,
      days: [
        {
          day_number: 1,
          start_time: "09:00",
          end_time: "21:00",
          activities: [makeActivity("a", 0, "09:00"), makeActivity("b", 1, "10:00")],
        },
      ],
    };
    setupStore(itinerary);
    expect(useItineraryStore.getState().getActivityDurationOverloadedDays().size).toBe(0);
  });

  it("returns day numbers whose total duration meets or exceeds the window", () => {
    const itinerary: Itinerary = {
      ...baseItinerary,
      days: [
        {
          day_number: 1,
          start_time: "09:00",
          end_time: "10:00",
          activities: [makeActivity("a", 0, "09:00"), makeActivity("b", 1, "09:30")],
        },
        {
          day_number: 2,
          start_time: "09:00",
          end_time: "21:00",
          activities: [makeActivity("c", 0, "09:00")],
        },
      ],
    };
    setupStore(itinerary);

    const overloadedDays = useItineraryStore.getState().getActivityDurationOverloadedDays();

    expect(overloadedDays.has(1)).toBe(true);
    expect(overloadedDays.has(2)).toBe(false);
  });

  it("treats total duration equal to the window as overloaded", () => {
    const itinerary: Itinerary = {
      ...baseItinerary,
      days: [
        {
          day_number: 1,
          start_time: "09:00",
          end_time: "10:00",
          activities: [makeActivity("a", 0, "09:00")],
        },
      ],
    };
    setupStore(itinerary);

    const overloadedDays = useItineraryStore.getState().getActivityDurationOverloadedDays();

    expect(overloadedDays.has(1)).toBe(true);
  });
});
