import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DayActivitiesList } from "@/components/planner/itinerary/components/day-activities-list";
import type { Day } from "@/types/itinerary";

const FINGERPRINT_AB = "5ec9700f46ea6adedfd104a52c8561bf992f0795639413845dccb85ea712a9cc";
const FINGERPRINT_ABC = "e3b76e7e4f9f3cd1763c2f5034c554de05629f11ea47e98cdf08ee32e1213a90";

const mocks = vi.hoisted(() => ({
  storeState: {
    dayMatrices: new Map(),
    optimizeWarnings: new Map(),
    isAddingActivity: false,
    addModePlaceholder: null,
    setIsAddingActivity: vi.fn(),
    setAddingActivityTarget: vi.fn(),
  },
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock("@/hooks/use-itinerary-permission", () => ({
  useItineraryPermission: () => ({ canEdit: true }),
}));

vi.mock("@/components/planner/itinerary/store", () => ({
  useItineraryStore: (selector: (state: typeof mocks.storeState) => unknown) =>
    selector(mocks.storeState),
}));

vi.mock("@/components/planner/itinerary/components/sortable-activity", () => ({
  SortableActivity: ({ activity }: { activity: { title: string } }) => <div>{activity.title}</div>,
}));

vi.mock("@/components/planner/itinerary/components/activity-placeholder-card", () => ({
  ActivityPlaceholderCard: () => <div data-testid="placeholder" />,
}));

vi.mock("@/components/planner/itinerary/components/droppable-day", () => ({
  DroppableDay: () => <div data-testid="droppable-day" />,
}));

const day: Day = {
  day_number: 1,
  transport_mode: "walking",
  start_time: "09:00",
  end_time: "21:00",
  activities: [
    {
      id: "a",
      title: "A",
      note: "",
      time: "09:00",
      duration_minutes: 60,
      order: 0,
      location: { name: "A", lat: 25, lng: 121 },
    },
    {
      id: "b",
      title: "B",
      note: "",
      time: "10:00",
      duration_minutes: 60,
      order: 1,
      location: { name: "B", lat: 25.1, lng: 121.1 },
    },
  ],
};

function renderList(inputDay: Day = day) {
  render(
    <DayActivitiesList
      day={inputDay}
      dayDate="2026-06-19"
      draggingActivityId={null}
      crossDayDragInfo={null}
      onActivityHover={vi.fn()}
      onActivityClick={vi.fn()}
    />,
  );
}

describe("DayActivitiesList travel matrix display", () => {
  beforeEach(() => {
    mocks.storeState.dayMatrices = new Map();
    mocks.storeState.optimizeWarnings = new Map();
    mocks.storeState.isAddingActivity = false;
    mocks.storeState.addModePlaceholder = null;
  });

  it("shows travel minutes when matrix ids, transport mode, and fingerprint match the day", async () => {
    mocks.storeState.dayMatrices = new Map([
      [
        1,
        {
          activityIds: ["a", "b"],
          matrix: [
            [0, 12],
            [12, 0],
          ],
          transportMode: "walking",
          locationFingerprint: FINGERPRINT_AB,
          matrixSource: "google_routes_matrix",
        },
      ],
    ]);

    renderList();

    expect(await screen.findByText("12 min")).toBeInTheDocument();
  });

  it("hides travel minutes when cached fingerprint no longer matches the day", async () => {
    mocks.storeState.dayMatrices = new Map([
      [
        1,
        {
          activityIds: ["a", "b"],
          matrix: [
            [0, 12],
            [12, 0],
          ],
          transportMode: "walking",
          locationFingerprint: "stale-fingerprint",
          matrixSource: "google_routes_matrix",
        },
      ],
    ]);

    renderList();

    await waitFor(() => expect(screen.queryByText("12 min")).not.toBeInTheDocument());
  });

  it("hides travel minutes when cached transport mode does not match the day", () => {
    mocks.storeState.dayMatrices = new Map([
      [
        1,
        {
          activityIds: ["a", "b"],
          matrix: [
            [0, 3],
            [3, 0],
          ],
          transportMode: "driving",
          locationFingerprint: FINGERPRINT_AB,
          matrixSource: "google_routes_matrix",
        },
      ],
    ]);

    renderList();

    expect(screen.queryByText("3 min")).not.toBeInTheDocument();
  });

  it("shows travel minutes when cached activity ids match in a different order", async () => {
    mocks.storeState.dayMatrices = new Map([
      [
        1,
        {
          activityIds: ["b", "a"],
          matrix: [
            [0, 8],
            [8, 0],
          ],
          transportMode: "walking",
          locationFingerprint: FINGERPRINT_AB,
          matrixSource: "google_routes_matrix",
        },
      ],
    ]);

    renderList();

    expect(await screen.findByText("8 min")).toBeInTheDocument();
  });

  it("shows travel minutes from a cached matrix subset after an activity is removed", () => {
    mocks.storeState.dayMatrices = new Map([
      [
        1,
        {
          activityIds: ["a", "b", "c"],
          matrix: [
            [0, 7, 19],
            [7, 0, 11],
            [19, 11, 0],
          ],
          transportMode: "walking",
          locationFingerprint: FINGERPRINT_ABC,
          matrixSource: "google_routes_matrix",
        },
      ],
    ]);

    renderList({
      ...day,
      activities: [
        day.activities[0],
        {
          id: "c",
          title: "C",
          note: "",
          time: "11:00",
          duration_minutes: 60,
          order: 2,
          location: { name: "C", lat: 25.2, lng: 121.2 },
        },
      ],
    });

    expect(screen.getByText("19 min")).toBeInTheDocument();
  });

  it("shows travel minutes for covered activity pairs even when another day activity is missing from the matrix", async () => {
    mocks.storeState.dayMatrices = new Map([
      [
        1,
        {
          activityIds: ["a", "b"],
          matrix: [
            [0, 12],
            [12, 0],
          ],
          transportMode: "walking",
          locationFingerprint: FINGERPRINT_AB,
          matrixSource: "google_routes_matrix",
        },
      ],
    ]);

    renderList({
      ...day,
      activities: [
        ...day.activities,
        {
          id: "c",
          title: "C",
          note: "",
          time: "11:00",
          duration_minutes: 60,
          order: 2,
          location: { name: "C" },
        },
      ],
    });

    expect(await screen.findByText("12 min")).toBeInTheDocument();
  });

  it("moves warning activities into an unscheduled section without travel minutes", () => {
    mocks.storeState.dayMatrices = new Map([
      [
        1,
        {
          activityIds: ["a", "b"],
          matrix: [
            [0, 12],
            [12, 0],
          ],
          transportMode: "walking",
          locationFingerprint: FINGERPRINT_AB,
          matrixSource: "google_routes_matrix",
        },
      ],
    ]);
    mocks.storeState.optimizeWarnings = new Map([
      [
        "b",
        {
          code: "ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS",
          dayNumber: 1,
          activityId: "b",
          title: "B",
          durationMinutes: 60,
          reason: "DAY_END",
          dayEndTime: "21:00",
        },
      ],
    ]);

    renderList();

    expect(screen.getByText("Unable to schedule")).toBeInTheDocument();
    expect(screen.queryByText("12 min")).not.toBeInTheDocument();
  });
});
