/**
 * Activity Card Component
 *
 * Displays activity information including time, location, description, and duration.
 */

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, ExternalLink, Pencil, MapPin, Star, MapPinOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ActivityCardProps } from "../types";
import { createDirectionsLink, createPlaceSearchLink } from "@/lib/maps/utils";
import { hasValidCoordinates } from "@/lib/utils/geo";
import { parseLocalDate } from "@/lib/utils/date";
import { EditActivityDialog } from "./edit-activity-dialog";
import { useItineraryPermission } from "@/hooks/use-itinerary-permission";

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutesAsTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, minutes));
  if (clamped === 24 * 60) return "00:00";
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function getOpeningHoursConstraint(
  activity: ActivityCardProps["activity"],
): { latestStart: string; close: string } | { availableMinutes: number } | null {
  if (!activity.opening_hours) return null;

  const openMinutes = parseTimeToMinutes(activity.opening_hours.open);
  const rawCloseMinutes = parseTimeToMinutes(activity.opening_hours.close);
  const closeMinutes =
    rawCloseMinutes === 0 || rawCloseMinutes < openMinutes ? 24 * 60 : rawCloseMinutes;
  const latestStartMinutes = closeMinutes - activity.duration_minutes;

  if (latestStartMinutes < openMinutes) {
    return { availableMinutes: Math.max(0, closeMinutes - openMinutes) };
  }

  return {
    latestStart: formatMinutesAsTime(latestStartMinutes),
    close: formatMinutesAsTime(closeMinutes),
  };
}

function stripWeekdayPrefix(description: string): string {
  const separatorIndex = description.indexOf(":");
  if (separatorIndex === -1) return description;
  return description.slice(separatorIndex + 1).trim();
}

function getOpeningHoursDisplay(
  activity: ActivityCardProps["activity"],
  dayDate?: string,
): string | null {
  if (activity.opening_hours) {
    return `${activity.opening_hours.open}-${activity.opening_hours.close}`;
  }

  const weekdayDescriptions = activity.location.opening_hours?.weekdayDescriptions;
  if (
    Array.isArray(weekdayDescriptions) &&
    weekdayDescriptions.every(
      (description): description is string => typeof description === "string",
    )
  ) {
    if (!dayDate) return null;
    const dayIndex = (parseLocalDate(dayDate).getDay() + 6) % 7;
    const description = weekdayDescriptions[dayIndex];
    return description ? stripWeekdayPrefix(description) : null;
  }

  return null;
}

export function ActivityCard({
  activity,
  dayDate,
  className,
  optimizeWarning,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: ActivityCardProps) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { canEdit } = useItineraryPermission();
  const tWarnings = useTranslations("planner.routeWarnings");
  const openingHoursConstraint = getOpeningHoursConstraint(activity);
  const openingHoursDisplay = getOpeningHoursDisplay(activity, dayDate);

  const handleNavigationConfig = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = createDirectionsLink(activity.location);
    window.open(url, "_blank");
  };

  const handleExternalLinkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activity.location.website) {
      window.open(activity.location.website, "_blank");
    } else {
      const url = createPlaceSearchLink(activity.location);
      window.open(url, "_blank");
    }
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditDialogOpen(true);
  };

  return (
    <Card
      className={`group relative ${className}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity z-50 cursor-pointer"
        onClick={handleExternalLinkClick}
        title="Open Website"
      >
        <ExternalLink className="h-4 w-4" />
      </Button>

      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute bottom-2 right-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity z-50 cursor-pointer"
          onClick={handleEditClick}
          title="Edit Activity"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      )}

      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Time Badge */}
          <div className="flex-shrink-0 px-2 py-1 bg-primary/10 rounded text-xs font-medium text-primary">
            {optimizeWarning ? tWarnings("unscheduledTime") : activity.time}
          </div>

          <div className="flex-1 min-w-0 pr-6">
            <h4 className="font-semibold text-sm mb-2 break-words">{activity.title}</h4>

            <Button
              variant="ghost"
              className="flex items-center gap-1 text-xs opacity-100 mb-1 h-auto p-1 -ml-1 cursor-pointer w-fit max-w-full"
              onClick={handleNavigationConfig}
              title={
                hasValidCoordinates(activity.location)
                  ? "Navigate with Google Maps"
                  : "No location data"
              }
            >
              {hasValidCoordinates(activity.location) ? (
                <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
              ) : (
                <MapPinOff className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              )}
              <span
                className={cn(
                  "truncate",
                  !hasValidCoordinates(activity.location) && "text-muted-foreground",
                )}
              >
                {activity.location.name}
              </span>
            </Button>

            {typeof activity.location.rating === "number" && (
              <div className="flex items-center gap-1 text-[11px] mb-2 pl-1 select-none">
                <span className="font-medium">{activity.location.rating.toFixed(1)}</span>
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400 -mt-[1px]" />
                {typeof activity.location.user_ratings_total === "number" && (
                  <span className="text-muted-foreground ml-0.5">
                    ({activity.location.user_ratings_total.toLocaleString()})
                  </span>
                )}
              </div>
            )}

            {activity.note && (
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">📝 {activity.note}</p>
            )}

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>{activity.duration_minutes} min</span>
              </div>
            </div>

            <div className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
              <Clock className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span
                className={cn("line-clamp-2", !openingHoursDisplay && "text-muted-foreground/70")}
              >
                {openingHoursDisplay
                  ? tWarnings("openingHoursLabel", { hours: openingHoursDisplay })
                  : tWarnings("openingHoursUnknown")}
              </span>
            </div>

            {optimizeWarning?.code === "ACTIVITY_WINDOW_TOO_SHORT" && (
              <div className="mt-2 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  {tWarnings("openingWindowTooShort", {
                    availableMinutes: optimizeWarning.availableMinutes,
                    durationMinutes: optimizeWarning.durationMinutes,
                  })}
                </span>
              </div>
            )}

            {optimizeWarning?.code === "ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS" && (
              <div className="mt-2 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  {openingHoursConstraint && "latestStart" in openingHoursConstraint
                    ? tWarnings("openingHoursMissed", openingHoursConstraint)
                    : optimizeWarning.reason === "DAY_END"
                      ? tWarnings("dayEndExceeded", {
                          dayEndTime: optimizeWarning.dayEndTime ?? tWarnings("dayEndFallback"),
                        })
                      : tWarnings("routeConstraints")}
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>

      {canEdit && (
        <EditActivityDialog
          activity={activity}
          isOpen={isEditDialogOpen}
          onClose={() => setIsEditDialogOpen(false)}
        />
      )}
    </Card>
  );
}
