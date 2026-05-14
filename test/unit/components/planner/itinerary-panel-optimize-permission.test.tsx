import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ItineraryPanel } from "@/components/planner/itinerary-panel";
import type { AccessContext } from "@/types/share";
import type { Itinerary } from "@/types/itinerary";

const mocks = vi.hoisted(() => ({
  session: null as { access_token?: string } | null,
  permission: { canEdit: true, isReadOnly: false },
  access: { permission: "edit", source: "link_share" } as AccessContext,
  storeState: {
    itinerary: {
      id: "itin-1",
      user_id: "user-1",
      title: "Taipei Weekend",
      destination: "Taipei",
      start_date: "2026-05-01",
      end_date: "2026-05-02",
      preferences: undefined,
      status: "completed",
      days: [
        {
          day_number: 1,
          start_time: "09:00",
          end_time: "21:00",
          transport_mode: "driving",
          activities: [],
        },
      ],
      settings: {
        startTime: "09:00",
        endTime: "21:00",
        transportMode: "driving",
      },
      link_access: "edit",
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-05-01T00:00:00.000Z",
    } as Itinerary,
    previewItinerary: null,
    access: { permission: "edit", source: "link_share" } as AccessContext,
    draggingActivityId: null,
    crossDayDragInfo: null,
    setDraggingActivityId: vi.fn(),
    setCrossDayDragInfo: vi.fn(),
    handleDragOver: vi.fn(),
    startPreview: vi.fn(),
    applyPreview: vi.fn(),
    discardPreview: vi.fn(),
    resetDragState: vi.fn(),
    setHoveredDay: vi.fn(),
    setHoveredActivity: vi.fn(),
    setFocusedActivity: vi.fn(),
    isAddingActivity: false,
    setIsAddingActivity: vi.fn(),
    addingActivityTarget: null,
    setAddingActivityTarget: vi.fn(),
    setDayTimeWindow: vi.fn(),
    setAllDaysTimeWindow: vi.fn(),
    setDayTransportMode: vi.fn(),
    setAllDaysTransportMode: vi.fn(),
    optimizeDayRoutes: vi.fn(),
    getActivityDurationOverloadedDays: vi.fn(() => new Set<number>()),
    optimizingDays: new Set<number>(),
  },
}));

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({ session: mocks.session }),
}));

vi.mock("@/hooks/use-profile", () => ({
  useProfile: () => ({ refreshProfile: vi.fn() }),
}));

vi.mock("@/hooks/use-itinerary-permission", () => ({
  useItineraryPermission: () => ({
    permission: mocks.access.permission,
    isOwner: mocks.access.permission === "owner",
    canEdit: mocks.permission.canEdit,
    canDelete: mocks.access.permission === "owner",
    canShare: mocks.access.permission === "owner",
    isReadOnly: mocks.permission.isReadOnly,
  }),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => ({})),
}));

vi.mock("@/components/planner/itinerary/hooks/use-global-add-mode-tracking", () => ({
  useGlobalAddModeTracking: vi.fn(),
}));

vi.mock("@/components/planner/itinerary", () => ({
  PanelHeader: () => <div data-testid="panel-header" />,
  ChatToggleButton: () => <div data-testid="chat-toggle" />,
  ActivityCard: () => <div data-testid="activity-card" />,
  AddActivityDialog: () => <div data-testid="add-activity-dialog" />,
  ExpandableView: ({ onOptimizeDay }: { onOptimizeDay?: (dayNumber: number) => void }) => (
    <div data-testid="expandable-view">
      {onOptimizeDay && <button type="button">Optimize route</button>}
    </div>
  ),
  SingleDayView: ({ onOptimizeDay }: { onOptimizeDay?: (dayNumber: number) => void }) => (
    <div data-testid="single-day-view">
      {onOptimizeDay && <button type="button">Optimize route</button>}
    </div>
  ),
  SideBySideView: ({ onOptimizeDay }: { onOptimizeDay?: (dayNumber: number) => void }) => (
    <div data-testid="side-by-side-view">
      {onOptimizeDay && <button type="button">Optimize route</button>}
    </div>
  ),
}));

vi.mock("@/components/planner/itinerary/store", () => ({
  OptimizeError: class OptimizeError extends Error {
    constructor(public kind: "INSUFFICIENT_CREDITS" | "GENERIC") {
      super(kind);
    }
  },
  useItineraryStore: (selector: (state: typeof mocks.storeState) => unknown) =>
    selector(mocks.storeState),
}));

function renderPanel() {
  render(
    <ItineraryPanel
      currentDayIndex={0}
      onCurrentDayChange={vi.fn()}
      isChatOpen={false}
      onToggleChat={vi.fn()}
    />,
  );
}

describe("ItineraryPanel optimize permission", () => {
  beforeEach(() => {
    mocks.session = null;
    mocks.permission.canEdit = true;
    mocks.permission.isReadOnly = false;
    mocks.access = { permission: "edit", source: "link_share" };
    mocks.storeState.access = mocks.access;
  });

  it("hides route optimization for anonymous public edit links", () => {
    renderPanel();

    expect(screen.queryByRole("button", { name: "Optimize route" })).not.toBeInTheDocument();
  });

  it("shows route optimization for editable users with an auth token", () => {
    mocks.session = { access_token: "token" };

    renderPanel();

    expect(screen.getByRole("button", { name: "Optimize route" })).toBeInTheDocument();
  });
});
