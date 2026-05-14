/**
 * Single Day View Component
 *
 * Displays one day at a time with navigation arrows.
 */

"use client";

import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { DayActivitiesList } from "../components/day-activities-list";
import { DayTimePicker } from "../components/day-time-picker";
import { DayTransportPicker } from "../components/day-transport-picker";
import { formatDayHeader } from "@/lib/utils/date";
import { calculateDayDate } from "@/lib/utils/date";
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
  activityDurationOverloadedDays,
  optimizingDays,
  onOptimizeDay,
}: SingleDayViewProps) {
  const locale = useLocale();
  const t = useTranslations("planner");
  const day = itinerary.days[currentDayIndex];
  if (!day) return null;
  const formattedDate = formatDayHeader(
    calculateDayDate(itinerary.start_date, day.day_number),
    locale,
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
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
          <div className="flex justify-center items-center gap-2">
            <h2 className="text-lg font-semibold">{t("dayLabel", { day: day.day_number })}</h2>
            {activityDurationOverloadedDays.has(day.day_number) && (
              <span
                className="text-sm text-amber-600 dark:text-amber-400"
                title={t("dayActivityDurationOverloaded")}
              >
                !
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{formattedDate}</p>
          {activityDurationOverloadedDays.has(day.day_number) && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              {t("dayActivityDurationOverloaded")}
            </p>
          )}
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
            {onOptimizeDay !== null && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={optimizingDays.has(day.day_number)}
                onClick={() => onOptimizeDay(day.day_number)}
              >
                {optimizingDays.has(day.day_number) ? t("optimizingRoute") : t("optimizeDayRoute")}
              </Button>
            )}
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

      <div className="flex-1 overflow-y-auto p-4">
        <DayActivitiesList
          day={day}
          dayDate={calculateDayDate(itinerary.start_date, day.day_number)}
          draggingActivityId={draggingActivityId}
          crossDayDragInfo={crossDayDragInfo}
          onActivityHover={onActivityHover}
          onActivityClick={onActivityClick}
        />
      </div>
    </div>
  );
}
