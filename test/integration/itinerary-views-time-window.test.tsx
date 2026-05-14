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
  preferences: undefined,
  settings: {
    startTime: "09:00",
    endTime: "21:00",
    transportMode: "driving",
  },
  days: [
    {
      day_number: 1,
      activities: [],
      start_time: "09:00",
      end_time: "20:00",
      transport_mode: "driving",
    },
    {
      day_number: 2,
      activities: [],
      start_time: "08:00",
      end_time: "21:00",
      transport_mode: "driving",
    },
  ],
  status: "completed",
  link_access: "none",
  created_at: "2026-04-16T00:00:00Z",
  updated_at: "2026-04-16T00:00:00Z",
};

const noop = vi.fn().mockResolvedValue(undefined);
const routeOptimizationProps = {
  activityDurationOverloadedDays: new Set<number>(),
  optimizingDays: new Set<number>(),
  onOptimizeDay: null,
};

function renderExpandable(overrides: Partial<React.ComponentProps<typeof ExpandableView>> = {}) {
  return render(
    <ExpandableView
      {...routeOptimizationProps}
      itinerary={baseItinerary}
      draggingActivityId={null}
      crossDayDragInfo={null}
      expandedDays={new Set()}
      toggleDay={vi.fn()}
      {...overrides}
    />,
  );
}

describe("ExpandableView - day controls integration", () => {
  beforeEach(() => noop.mockClear());

  it("renders each day time range and wires save to the day number", async () => {
    renderExpandable({ setDayTimeWindow: noop, setAllDaysTimeWindow: noop });

    const buttons = screen.getAllByRole("button", { name: /\d{2}:\d{2}.*\d{2}:\d{2}/i });
    expect(buttons[0]).toHaveTextContent("09:00");
    expect(buttons[0]).toHaveTextContent("20:00");
    expect(buttons[1]).toHaveTextContent("08:00");
    expect(buttons[1]).toHaveTextContent("21:00");

    fireEvent.click(screen.getByRole("button", { name: /09:00.*20:00/i }));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(noop).toHaveBeenCalledWith(1, "09:00", "20:00");
    });
  });

  it("renders time controls as disabled when callbacks are absent", () => {
    renderExpandable();

    const buttons = screen.getAllByRole("button", { name: /\d{2}:\d{2}.*\d{2}:\d{2}/i });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeDisabled();
  });

  it("renders overload and optimize states from explicit route optimization props", () => {
    const onOptimizeDay = vi.fn();
    const toggleDay = vi.fn();
    renderExpandable({
      toggleDay,
      activityDurationOverloadedDays: new Set([1]),
      optimizingDays: new Set([1]),
      onOptimizeDay,
    });

    expect(screen.getByText(/Activities exceed time window/)).toBeInTheDocument();
    const optimizingBtn = screen.getByRole("button", { name: "Optimizing..." });
    expect(optimizingBtn).toBeDisabled();
    expect(screen.getByRole("button", { name: "Optimize route" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Optimize route" }));
    expect(onOptimizeDay).toHaveBeenCalledWith(2);
    expect(toggleDay).not.toHaveBeenCalled();
  });
});

describe("SingleDayView - day controls integration", () => {
  beforeEach(() => noop.mockClear());

  it("renders the current day time range and wires apply-all", async () => {
    render(
      <SingleDayView
        {...routeOptimizationProps}
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

    fireEvent.click(button);
    fireEvent.click(screen.getByText("Apply to all days"));

    await waitFor(() => {
      expect(noop).toHaveBeenCalledWith("09:00", "20:00");
    });
  });
});

describe("SideBySideView - day controls integration", () => {
  beforeEach(() => noop.mockClear());

  it("renders all day time ranges and wires save to the selected day", async () => {
    render(
      <SideBySideView
        {...routeOptimizationProps}
        itinerary={baseItinerary}
        draggingActivityId={null}
        crossDayDragInfo={null}
        setDayTimeWindow={noop}
        setAllDaysTimeWindow={noop}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: /\d{2}:\d{2}.*\d{2}:\d{2}/i });
    expect(buttons[0]).toHaveTextContent("09:00");
    expect(buttons[1]).toHaveTextContent("08:00");

    fireEvent.click(screen.getByRole("button", { name: /08:00.*21:00/i }));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(noop).toHaveBeenCalledWith(2, "08:00", "21:00");
    });
  });
});
