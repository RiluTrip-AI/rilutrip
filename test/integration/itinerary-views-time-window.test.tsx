import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/components/planner/itinerary/components/day-activities-list", () => ({
  DayActivitiesList: () => <div data-testid="day-activities-list" />,
}));

vi.mock("@/lib/utils/date", () => ({
  formatDayHeader: () => "May 1, 2026",
  calculateDayDate: () => "2026-05-01",
}));

import { ExpandableView } from "@/components/planner/itinerary/views/expandable-view";
import { SingleDayView } from "@/components/planner/itinerary/views/single-day-view";
import { SideBySideView } from "@/components/planner/itinerary/views/side-by-side-view";
import type { Itinerary } from "@/types/itinerary";

const baseItinerary: Itinerary = {
  id: "itin-1",
  user_id: "u1",
  title: "Test Trip",
  destination: "Tokyo",
  start_date: "2026-05-01",
  end_date: "2026-05-03",
  description: undefined,
  days: [
    { day_number: 1, activities: [], start_time: "09:00", end_time: "20:00" },
    { day_number: 2, activities: [], start_time: "08:00", end_time: "21:00" },
  ],
  status: "completed",
  link_access: "none",
  created_at: "2026-04-16T00:00:00Z",
  updated_at: "2026-04-16T00:00:00Z",
};

const noop = vi.fn().mockResolvedValue(undefined);

// ──────────────────────────────────────────────────────────────────────────────
// ExpandableView
// ──────────────────────────────────────────────────────────────────────────────

describe("ExpandableView - DayTimePicker integration", () => {
  beforeEach(() => noop.mockClear());

  it("shows time display for each day when callbacks are provided", () => {
    render(
      <ExpandableView
        itinerary={baseItinerary}
        draggingActivityId={null}
        crossDayDragInfo={null}
        expandedDays={new Set()}
        toggleDay={vi.fn()}
        setDayTimeWindow={noop}
        setAllDaysTimeWindow={noop}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: /\d{2}:\d{2}.*\d{2}:\d{2}/i });
    expect(buttons[0]).toHaveTextContent("09:00");
    expect(buttons[0]).toHaveTextContent("20:00");
    expect(buttons[1]).toHaveTextContent("08:00");
    expect(buttons[1]).toHaveTextContent("21:00");
  });

  it("shows time display as disabled when callbacks are not provided", () => {
    render(
      <ExpandableView
        itinerary={baseItinerary}
        draggingActivityId={null}
        crossDayDragInfo={null}
        expandedDays={new Set()}
        toggleDay={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: /\d{2}:\d{2}.*\d{2}:\d{2}/i });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeDisabled();
  });

  it("opens the time panel and calls onSave with correct args", async () => {
    render(
      <ExpandableView
        itinerary={baseItinerary}
        draggingActivityId={null}
        crossDayDragInfo={null}
        expandedDays={new Set()}
        toggleDay={vi.fn()}
        setDayTimeWindow={noop}
        setAllDaysTimeWindow={noop}
      />,
    );
    const button = screen.getByRole("button", { name: /09:00.*20:00/i });
    fireEvent.click(button);
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(noop).toHaveBeenCalledWith(1, "09:00", "20:00");
    });
  });

  it("uses default time when day has no start_time or end_time", () => {
    const itinerary: Itinerary = {
      ...baseItinerary,
      days: [{ day_number: 1, activities: [] }],
    };
    render(
      <ExpandableView
        itinerary={itinerary}
        draggingActivityId={null}
        crossDayDragInfo={null}
        expandedDays={new Set()}
        toggleDay={vi.fn()}
        setDayTimeWindow={noop}
        setAllDaysTimeWindow={noop}
      />,
    );
    const button = screen.getByRole("button", { name: /09:00.*20:00/i });
    expect(button).toHaveTextContent("09:00");
    expect(button).toHaveTextContent("20:00");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SingleDayView
// ──────────────────────────────────────────────────────────────────────────────

describe("SingleDayView - DayTimePicker integration", () => {
  beforeEach(() => noop.mockClear());

  it("shows time display when callbacks are provided", () => {
    render(
      <SingleDayView
        itinerary={baseItinerary}
        currentDayIndex={0}
        draggingActivityId={null}
        crossDayDragInfo={null}
        goToPreviousDay={vi.fn()}
        goToNextDay={vi.fn()}
        setDayTimeWindow={noop}
        setAllDaysTimeWindow={noop}
      />,
    );
    const button = screen.getByRole("button", { name: /09:00.*20:00/i });
    expect(button).toHaveTextContent("09:00");
    expect(button).toHaveTextContent("20:00");
  });

  it("shows time display as disabled when callbacks are not provided", () => {
    render(
      <SingleDayView
        itinerary={baseItinerary}
        currentDayIndex={0}
        draggingActivityId={null}
        crossDayDragInfo={null}
        goToPreviousDay={vi.fn()}
        goToNextDay={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: /\d{2}:\d{2}.*\d{2}:\d{2}/i });
    expect(button).toBeDisabled();
  });

  it("calls onApplyAll with correct args when apply-all is clicked", async () => {
    render(
      <SingleDayView
        itinerary={baseItinerary}
        currentDayIndex={0}
        draggingActivityId={null}
        crossDayDragInfo={null}
        goToPreviousDay={vi.fn()}
        goToNextDay={vi.fn()}
        setDayTimeWindow={noop}
        setAllDaysTimeWindow={noop}
      />,
    );
    const button = screen.getByRole("button", { name: /09:00.*20:00/i });
    fireEvent.click(button);
    fireEvent.click(screen.getByText("Apply to all days"));
    await waitFor(() => {
      expect(noop).toHaveBeenCalledWith("09:00", "20:00");
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SideBySideView
// ──────────────────────────────────────────────────────────────────────────────

describe("SideBySideView - DayTimePicker integration", () => {
  beforeEach(() => noop.mockClear());

  it("shows time display for each day when callbacks are provided", () => {
    render(
      <SideBySideView
        itinerary={baseItinerary}
        draggingActivityId={null}
        crossDayDragInfo={null}
        setDayTimeWindow={noop}
        setAllDaysTimeWindow={noop}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: /\d{2}:\d{2}.*\d{2}:\d{2}/i });
    expect(buttons[0]).toHaveTextContent("09:00");
    expect(buttons[0]).toHaveTextContent("20:00");
    expect(buttons[1]).toHaveTextContent("08:00");
    expect(buttons[1]).toHaveTextContent("21:00");
  });

  it("shows time display as disabled when callbacks are not provided", () => {
    render(
      <SideBySideView
        itinerary={baseItinerary}
        draggingActivityId={null}
        crossDayDragInfo={null}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: /\d{2}:\d{2}.*\d{2}:\d{2}/i });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeDisabled();
  });

  it("calls onSave with correct args for the right day", async () => {
    render(
      <SideBySideView
        itinerary={baseItinerary}
        draggingActivityId={null}
        crossDayDragInfo={null}
        setDayTimeWindow={noop}
        setAllDaysTimeWindow={noop}
      />,
    );
    const button = screen.getByRole("button", { name: /08:00.*21:00/i });
    fireEvent.click(button);
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(noop).toHaveBeenCalledWith(2, "08:00", "21:00");
    });
  });
});
