import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActivityCard } from "@/components/planner/itinerary/components/activity-card";
import type { Activity } from "@/types/itinerary";

const createDirectionsLinkMock = vi.fn(() => "https://maps.example.com/route");
const createPlaceSearchLinkMock = vi.fn(() => "https://maps.example.com/place");

vi.mock("@/lib/maps/utils", () => ({
  createDirectionsLink: (...args: unknown[]) => createDirectionsLinkMock(...args),
  createPlaceSearchLink: (...args: unknown[]) => createPlaceSearchLinkMock(...args),
}));

vi.mock("@/components/planner/itinerary/components/edit-activity-dialog", () => ({
  EditActivityDialog: () => null,
}));

describe("ActivityCard", () => {
  const openSpy = vi.fn();

  beforeEach(() => {
    openSpy.mockReset();
    createDirectionsLinkMock.mockClear();
    createPlaceSearchLinkMock.mockClear();
    window.open = openSpy;
  });

  const baseActivity: Activity = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    time: "10:00",
    title: "Visit museum",
    note: "Check the special exhibition",
    location: {
      name: "City Museum",
      website: "https://museum.example.com",
    },
    duration_minutes: 90,
    order: 0,
  };

  it("opens location.website when the external-link button is clicked", () => {
    render(<ActivityCard activity={baseActivity} />);

    fireEvent.click(screen.getByTitle("Open Website"));

    expect(openSpy).toHaveBeenCalledWith("https://museum.example.com", "_blank");
    expect(createDirectionsLinkMock).not.toHaveBeenCalled();
    expect(createPlaceSearchLinkMock).not.toHaveBeenCalled();
  });

  it("opens the Google Maps directions link when the location name is clicked", () => {
    const activityWithCoords: Activity = {
      ...baseActivity,
      location: {
        ...baseActivity.location,
        lat: 40.7128,
        lng: -74.006,
      },
    };

    render(<ActivityCard activity={activityWithCoords} />);

    fireEvent.click(screen.getByTitle("Navigate with Google Maps"));

    expect(createDirectionsLinkMock).toHaveBeenCalledTimes(1);
    expect(createDirectionsLinkMock).toHaveBeenCalledWith(activityWithCoords.location);
    expect(openSpy).toHaveBeenCalledWith("https://maps.example.com/route", "_blank");
    expect(createPlaceSearchLinkMock).not.toHaveBeenCalled();
  });

  it("falls back to navigation link when location.website is missing", () => {
    render(
      <ActivityCard
        activity={{
          ...baseActivity,
          location: {
            name: "City Museum",
          },
        }}
      />,
    );

    fireEvent.click(screen.getByTitle("Open Website"));

    expect(createDirectionsLinkMock).not.toHaveBeenCalled();
    expect(createPlaceSearchLinkMock).toHaveBeenCalledTimes(1);
    expect(createPlaceSearchLinkMock).toHaveBeenCalledWith({ name: "City Museum" });
    expect(openSpy).toHaveBeenCalledWith("https://maps.example.com/place", "_blank");
  });

  it("shows the normalized opening hours on every activity card", () => {
    render(
      <ActivityCard
        activity={{
          ...baseActivity,
          opening_hours: {
            open: "09:30",
            close: "17:00",
          },
        }}
      />,
    );

    expect(screen.getByText("Opening hours: 09:30-17:00")).toBeInTheDocument();
  });

  it("shows unavailable opening hours when no opening data exists", () => {
    render(<ActivityCard activity={baseActivity} />);

    expect(screen.getByText("Opening hours unavailable")).toBeInTheDocument();
  });

  it("shows only the matching day opening hours from weekly descriptions", () => {
    render(
      <ActivityCard
        activity={{
          ...baseActivity,
          location: {
            ...baseActivity.location,
            opening_hours: {
              weekdayDescriptions: [
                "Monday: Closed",
                "Tuesday: 07:30 - 15:30",
                "Wednesday: 07:30 - 15:30",
                "Thursday: 07:30 - 15:30",
                "Friday: 09:00 - 17:00",
                "Saturday: 10:00 - 18:00",
                "Sunday: Closed",
              ],
            },
          },
        }}
        dayDate="2026-06-19"
      />,
    );

    expect(screen.getByText("Opening hours: 09:00 - 17:00")).toBeInTheDocument();
    expect(screen.queryByText(/Tuesday/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Saturday/)).not.toBeInTheDocument();
  });

  it("marks the time badge as unscheduled when the activity has an optimize warning", () => {
    render(
      <ActivityCard
        activity={baseActivity}
        optimizeWarning={{
          code: "ACTIVITY_WINDOW_TOO_SHORT",
          dayNumber: 1,
          activityId: baseActivity.id,
          title: baseActivity.title,
          openingHours: {
            open: "11:00",
            close: "11:30",
          },
          availableMinutes: 30,
          durationMinutes: 90,
        }}
      />,
    );

    expect(screen.getByText("Unscheduled")).toBeInTheDocument();
    expect(screen.queryByText("10:00")).not.toBeInTheDocument();
  });
});
