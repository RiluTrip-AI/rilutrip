import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PanelHeader } from "@/components/planner/itinerary/components/panel-header";
import type { Itinerary } from "@/types/itinerary";

const permissionState = {
  canEdit: true,
  canDelete: true,
  canShare: true,
};

const storeState = {
  isSaving: false,
  updateMetadata: vi.fn(),
  isAddingActivity: false,
  setIsAddingActivity: vi.fn(),
  getCanUndo: vi.fn(() => true),
  getCanRedo: vi.fn(() => true),
  undo: vi.fn(async () => {}),
  redo: vi.fn(async () => {}),
};

const editMetadataDialogSpy = vi.fn();

vi.mock("@/hooks/use-itinerary-permission", () => ({
  useItineraryPermission: () => ({
    permission: permissionState.canDelete ? "owner" : "edit",
    isOwner: permissionState.canDelete,
    canEdit: permissionState.canEdit,
    canDelete: permissionState.canDelete,
    canShare: permissionState.canShare,
    isReadOnly: !permissionState.canEdit,
  }),
}));

vi.mock("@/components/planner/itinerary/store", () => ({
  useItineraryStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock("@/components/share/share-dialog", () => ({
  ShareDialog: ({ itineraryTitle }: { itineraryTitle: string }) => (
    <div data-testid="share-dialog">{itineraryTitle}</div>
  ),
}));

vi.mock("@/components/planner/itinerary/components/edit-metadata-dialog", () => ({
  EditMetadataDialog: (props: unknown) => {
    editMetadataDialogSpy(props);
    return <div data-testid="edit-metadata-dialog" />;
  },
}));

vi.mock("@/lib/supabase/itineraries", () => ({
  deleteItinerary: vi.fn(),
}));

const itinerary: Itinerary = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  user_id: "550e8400-e29b-41d4-a716-446655440001",
  title: "Taipei Weekend",
  destination: "Taipei",
  start_date: "2026-04-04",
  end_date: "2026-04-06",
  description: undefined,
  status: "completed",
  days: [],
  link_access: "none",
  created_at: "2026-04-04T00:00:00.000Z",
  updated_at: "2026-04-04T00:00:00.000Z",
};

describe("PanelHeader", () => {
  beforeEach(() => {
    permissionState.canEdit = true;
    permissionState.canDelete = true;
    permissionState.canShare = true;
    editMetadataDialogSpy.mockClear();
  });

  it("does not mount edit metadata UI for read-only viewers", () => {
    permissionState.canEdit = false;
    permissionState.canDelete = false;
    permissionState.canShare = false;

    render(
      <PanelHeader
        itinerary={itinerary}
        viewMode="side-by-side"
        setViewMode={vi.fn()}
        isFullscreen={false}
        toggleFullscreen={vi.fn()}
      />,
    );

    expect(screen.queryByTitle("Edit Trip Details")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Add Activity")).not.toBeInTheDocument();
    expect(screen.queryByTestId("edit-metadata-dialog")).not.toBeInTheDocument();
  });

  it("renders share entry for owners", () => {
    render(
      <PanelHeader
        itinerary={itinerary}
        viewMode="side-by-side"
        setViewMode={vi.fn()}
        isFullscreen={false}
        toggleFullscreen={vi.fn()}
      />,
    );

    expect(screen.getByTestId("share-dialog")).toHaveTextContent("Taipei Weekend");
  });

  it("does not pass delete capability to non-owner editors", () => {
    permissionState.canEdit = true;
    permissionState.canDelete = false;
    permissionState.canShare = false;

    render(
      <PanelHeader
        itinerary={itinerary}
        viewMode="side-by-side"
        setViewMode={vi.fn()}
        isFullscreen={false}
        toggleFullscreen={vi.fn()}
      />,
    );

    expect(screen.getByTestId("edit-metadata-dialog")).toBeInTheDocument();
    const lastCall = editMetadataDialogSpy.mock.calls.at(-1)?.[0] as
      | { onDelete?: unknown }
      | undefined;
    expect(lastCall?.onDelete).toBeUndefined();
  });
});
