import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Itinerary, Activity } from "@/types/itinerary";

const mocks = vi.hoisted(() => ({
  updateItinerary: vi.fn(),
  loadItinerary: vi.fn(),
  getAccessToken: vi.fn().mockResolvedValue("tkn"),
}));

vi.mock("@/lib/supabase/itineraries", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/itineraries")>(
    "@/lib/supabase/itineraries",
  );
  return {
    ...actual,
    updateItinerary: mocks.updateItinerary,
    loadItinerary: mocks.loadItinerary,
  };
});
vi.mock("@/lib/supabase/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/supabase/client")>("@/lib/supabase/client");
  return { ...actual, getAccessToken: mocks.getAccessToken };
});
vi.mock("@/lib/supabase/shares", () => ({
  getEffectivePermission: vi.fn().mockResolvedValue({ permission: "owner", source: "owner" }),
}));
vi.mock("@/lib/ai/client", () => ({
  aiClient: { streamItinerary: vi.fn(), chat: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/lib/places/place-resolver", () => ({ resolvePlaceDetails: vi.fn() }));

import { useItineraryStore } from "@/components/planner/itinerary/store";

const ITINERARY_ID = "11111111-1111-1111-1111-111111111111";

const act = (id: string, order: number, lat?: number, lng?: number): Activity => ({
  id,
  title: `A${id}`,
  note: "",
  time: "09:00",
  duration_minutes: 60,
  order,
  location: { name: `P${id}`, lat, lng },
});

const baseItinerary = (): Itinerary => ({
  id: ITINERARY_ID,
  user_id: "u1",
  title: "T",
  destination: "Tokyo",
  start_date: "2026-05-01",
  end_date: "2026-05-01",
  description: undefined,
  days: [
    {
      day_number: 1,
      transport_mode: "driving",
      start_time: "09:00",
      end_time: "21:00",
      activities: [act("a", 0, 25, 121), act("b", 1, 25.1, 121.1)],
    },
  ],
  status: "completed",
  link_access: "none",
  created_at: "2026-04-16T00:00:00Z",
  updated_at: "2026-04-16T00:00:00Z",
});

function setup(itinerary = baseItinerary()) {
  useItineraryStore.setState({
    itinerary,
    access: { permission: "owner", source: "owner" },
    optimizingDays: new Set(),
    isSaving: false,
    saveError: false,
    historyPast: [],
    historyFuture: [],
  });
}

function okResponse() {
  return new Response(JSON.stringify({ ok: true, creditCaptured: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // optimizeDay reloads the server-written itinerary via loadItinerary on success.
  mocks.loadItinerary.mockResolvedValue(baseItinerary());
  setup();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("optimizeDay", () => {
  it("sends a minimal day-numbers payload, reloads from DB, and records undo history without writing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());

    const result = await useItineraryStore.getState().optimizeDay(1);

    expect(result).toEqual({ ok: true, unfitCount: 0 });
    const requestBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(requestBody).toEqual({ itineraryId: ITINERARY_ID, dayNumbers: [1] });
    // Server owns the DB write; the client reloads the result and records the
    // pre-optimize snapshot for Undo, but never writes itself.
    expect(mocks.loadItinerary).toHaveBeenCalledWith(ITINERARY_ID);
    expect(mocks.updateItinerary).not.toHaveBeenCalled();
    expect(useItineraryStore.getState().historyPast).toHaveLength(1);
  });

  it("surfaces the server's unfit-activity count on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, creditCaptured: true, unfitCount: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await useItineraryStore.getState().optimizeDay(1);

    expect(result).toEqual({ ok: true, unfitCount: 2 });
  });

  it("tracks concurrent optimizations independently in optimizingDays", async () => {
    const it = baseItinerary();
    it.days.push({
      day_number: 2,
      transport_mode: "driving",
      start_time: "09:00",
      end_time: "21:00",
      activities: [act("c", 0, 25, 121), act("d", 1, 25.1, 121.1)],
    });
    setup(it);

    const resolvers: Array<(res: Response) => void> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => resolvers.push(resolve)),
    );

    const p1 = useItineraryStore.getState().optimizeDay(1);
    const p2 = useItineraryStore.getState().optimizeDay(2);
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));

    // Both days are in flight at once without clobbering each other's spinner.
    expect(useItineraryStore.getState().optimizingDays.has(1)).toBe(true);
    expect(useItineraryStore.getState().optimizingDays.has(2)).toBe(true);

    resolvers.forEach((resolve) => resolve(okResponse()));
    await Promise.all([p1, p2]);

    expect(useItineraryStore.getState().optimizingDays.size).toBe(0);
  });

  it("no-ops when the day has fewer than 2 located activities", async () => {
    const it = baseItinerary();
    it.days[0].activities = [act("a", 0, 25, 121), act("b", 1)];
    setup(it);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await useItineraryStore.getState().optimizeDay(1);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: "NOT_ENOUGH_LOCATED" });
  });

  it("rejects without calling the API when the day is missing time/transport settings", async () => {
    const it = baseItinerary();
    delete it.days[0].transport_mode;
    setup(it);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await useItineraryStore.getState().optimizeDay(1);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: "MISSING_SETTINGS" });
  });

  it("does not refetch or mutate when the request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Insufficient credits", code: "INSUFFICIENT_CREDITS" }),
        {
          status: 402,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    const before = useItineraryStore.getState().itinerary!.days[0].activities.map((a) => a.id);

    const result = await useItineraryStore.getState().optimizeDay(1);

    const after = useItineraryStore.getState().itinerary!.days[0].activities.map((a) => a.id);
    expect(after).toEqual(before);
    expect(mocks.loadItinerary).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: "INSUFFICIENT_CREDITS" });
  });

  it("surfaces unauthorized responses separately from generic optimize failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await useItineraryStore.getState().optimizeDay(1);

    expect(mocks.loadItinerary).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: "UNAUTHORIZED" });
  });
});
