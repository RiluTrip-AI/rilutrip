/**
 * Single Day View Component
 *
 * Displays one day at a time with navigation arrows.
 */

"use client";

import { useLocale } from "next-intl";

import { Button } from "@/components/ui/button";
import { DayActivitiesList } from "../components/day-activities-list";
import { DayTimePicker } from "../components/day-time-picker";
import { DayTransportPicker } from "../components/day-transport-picker";
import { OptimizeDayButton } from "../components/optimize-day-button";
import { formatDayHeader } from "@/lib/utils/date";
import { calculateDayDate } from "@/lib/utils/date";
import { hasValidCoordinates } from "@/lib/utils/geo";
import type { SingleDayViewProps } from "../types";

export function SingleDayView({
  itinerary,
  currentDayIndex,
  draggingActivityId,
  crossDayDragInfo,
  goToPreviousDay,
  goToNextDay,
  onActivityHover,
  onActivityClick,
  setDayTimeWindow,
  setAllDaysTimeWindow,
  setDayTransportMode,
  setAllDaysTransportMode,
  optimizeDay,
  optimizingDays,
}: SingleDayViewProps) {
  const locale = useLocale();
  const day = itinerary.days[currentDayIndex];
  if (!day) return null;
  const formattedDate = formatDayHeader(
    calculateDayDate(itinerary.start_date, day.day_number),
    locale,
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Navigation Controls */}
      <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-border bg-background">
        <Button
          variant="ghost"
          size="sm"
          onClick={goToPreviousDay}
          disabled={currentDayIndex === 0}
          className="h-8 w-8 p-0"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Button>

        <div className="text-center">
          <h2 className="text-lg font-semibold">Day {day.day_number}</h2>
          <p className="text-sm text-muted-foreground">{formattedDate}</p>
          <div className="flex justify-center items-center gap-2 mt-1">
            <DayTimePicker
              dayNumber={day.day_number}
              startTime={day.start_time}
              endTime={day.end_time}
              onSave={setDayTimeWindow}
              onApplyAll={setAllDaysTimeWindow}
            />
            <DayTransportPicker
              dayNumber={day.day_number}
              mode={day.transport_mode}
              onSave={setDayTransportMode}
              onApplyAll={setAllDaysTransportMode}
            />
            <OptimizeDayButton
              dayNumber={day.day_number}
              locatedActivityCount={
                day.activities.filter((a) => hasValidCoordinates(a.location)).length
              }
              isOptimizing={optimizingDays.has(day.day_number)}
              onOptimize={optimizeDay}
            />
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={goToNextDay}
          disabled={currentDayIndex === itinerary.days.length - 1}
          className="h-8 w-8 p-0"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Button>
      </div>

      {/* Day Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <DayActivitiesList
          day={day}
          draggingActivityId={draggingActivityId}
          crossDayDragInfo={crossDayDragInfo}
          onActivityHover={onActivityHover}
          onActivityClick={onActivityClick}
        />
      </div>
    </div>
  );
}
