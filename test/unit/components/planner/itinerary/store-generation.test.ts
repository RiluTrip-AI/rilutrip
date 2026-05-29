// test/unit/components/planner/itinerary/store-generation.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { Itinerary } from "@/types/itinerary";

// Hoisted mocks — must be declared via vi.hoisted so they're available when the
// module under test is evaluated.
const mocks = vi.hoisted(() => ({
  streamItinerary: vi.fn(),
  loadItinerary: vi.fn(),
  getEffectivePermission: vi.fn(),
}));

vi.mock("@/lib/ai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/client")>("@/lib/ai/client");
  return {
    ...actual,
    aiClient: { streamItinerary: mocks.streamItinerary, chat: vi.fn() },
  };
});

vi.mock("@/lib/supabase/itineraries", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/itineraries")>(
    "@/lib/supabase/itineraries",
  );
  return { ...actual, loadItinerary: mocks.loadItinerary };
});

vi.mock("@/lib/supabase/shares", () => ({
  getEffectivePermission: mocks.getEffectivePermission,
}));

import { useItineraryStore } from "@/components/planner/itinerary/store";

const baseItinerary: Itinerary = {
  id: "itin-1",
  user_id: "u1",
  title: "Test",
  destination: "Tokyo",
  start_date: "2026-05-01",
  end_date: "2026-05-03",
  description: undefined,
  days: [],
  status: "draft",
  link_access: "private",
  created_at: "2026-04-16T00:00:00Z",
  updated_at: "2026-04-16T00:00:00Z",
};

function resetStore(partial: Partial<ReturnType<typeof useItineraryStore.getState>> = {}) {
  useItineraryStore.setState({
    itinerary: null,
    isGenerating: false,
    generationAbortController: null,
    errorKind: null,
    errorCode: null,
    ...partial,
  });
}

describe("store startGeneration / stopGeneration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.streamItinerary.mockReset();
    mocks.loadItinerary.mockReset();
    mocks.getEffectivePermission.mockReset();
  });

  afterEach(() => {
    // Abort any in-flight stream/polling to prevent leaks across tests.
    useItineraryStore.getState().stopGeneration();
    vi.useRealTimers();
  });

  it("uses streaming when itinerary is a fresh draft with zero days", async () => {
    resetStore({ itinerary: { ...baseItinerary, status: "draft", days: [] } });
    mocks.streamItinerary.mockImplementation(() => new Promise(() => {})); // hang forever

    useItineraryStore.getState().startGeneration("itin-1", "en");

    expect(mocks.streamItinerary).toHaveBeenCalledTimes(1);
    expect(mocks.loadItinerary).not.toHaveBeenCalled();
    expect(useItineraryStore.getState().isGenerating).toBe(true);
  });

  it("uses polling (not streaming) when itinerary.status === 'generating'", async () => {
    resetStore({ itinerary: { ...baseItinerary, status: "generating" } });
    mocks.loadItinerary.mockResolvedValue({ ...baseItinerary, status: "generating" });

    useItineraryStore.getState().startGeneration("itin-1", "en");

    expect(useItineraryStore.getState().isGenerating).toBe(true);
    expect(mocks.streamItinerary).not.toHaveBeenCalled();

    // Advance one polling tick — polling uses setInterval with 3000ms.
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.loadItinerary).toHaveBeenCalled();
  });

  it("stopGeneration aborts in-flight streaming and clears isGenerating", () => {
    const abortSpy = vi.fn();
    resetStore({
      itinerary: { ...baseItinerary },
      isGenerating: true,
      generationAbortController: { abort: abortSpy, signal: {} as AbortSignal } as AbortController,
    });

    useItineraryStore.getState().stopGeneration();

    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(useItineraryStore.getState().isGenerating).toBe(false);
    expect(useItineraryStore.getState().generationAbortController).toBeNull();
  });

  it("stopGeneration stops polling so no further loadItinerary calls occur", async () => {
    resetStore({ itinerary: { ...baseItinerary, status: "generating" } });
    mocks.loadItinerary.mockResolvedValue({ ...baseItinerary, status: "generating" });

    useItineraryStore.getState().startGeneration("itin-1", "en");
    await vi.advanceTimersByTimeAsync(3000);
    const callsBeforeStop = mocks.loadItinerary.mock.calls.length;

    useItineraryStore.getState().stopGeneration();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mocks.loadItinerary.mock.calls.length).toBe(callsBeforeStop);
    expect(useItineraryStore.getState().isGenerating).toBe(false);
  });
});
