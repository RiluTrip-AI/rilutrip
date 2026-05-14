/**
 * Expandable View Component
 *
 * Displays days in an accordion-style view with expandable/collapsible sections.
 */

"use client";

import { useLocale, useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DayActivitiesList } from "../components/day-activities-list";
import { DayTimePicker } from "../components/day-time-picker";
import { DayTransportPicker } from "../components/day-transport-picker";
import { formatDayHeader } from "@/lib/utils/date";
import { calculateDayDate } from "@/lib/utils/date";
import type { ExpandableViewProps } from "../types";

export function ExpandableView({
  itinerary,
  draggingActivityId,
  crossDayDragInfo,
  expandedDays,
  toggleDay,
  onDayHover,
  onActivityHover,
  onActivityClick,
  setDayTimeWindow,
  setAllDaysTimeWindow,
  setDayTransportMode,
  setAllDaysTransportMode,
  activityDurationOverloadedDays,
  optimizingDays,
  onOptimizeDay,
}: ExpandableViewProps) {
  const locale = useLocale();
  const t = useTranslations("planner");

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {itinerary.days.map((day) => {
        const isExpanded = expandedDays.has(day.day_number);
        const formattedDate = formatDayHeader(
          calculateDayDate(itinerary.start_date, day.day_number),
          locale,
        );

        return (
          <Card key={day.day_number} className="overflow-hidden">
            <CardHeader
              className="cursor-pointer hover:bg-accent/50 transition-colors p-4"
              onClick={() => toggleDay(day.day_number)}
              onMouseEnter={() => onDayHover?.(day.day_number)}
              onMouseLeave={() => onDayHover?.(null)}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">
                      {t("dayLabel", { day: day.day_number })}
                    </CardTitle>
                    {activityDurationOverloadedDays.has(day.day_number) && (
                      <span
                        className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1"
                        title={t("dayActivityDurationOverloaded")}
                      >
                        ! {t("dayActivityDurationOverloaded")}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{formattedDate}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-muted-foreground">
                      {day.activities.length}{" "}
                      {day.activities.length === 1 ? "activity" : "activities"}
                    </p>
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
                        className="h-6 px-2 text-xs"
                        disabled={optimizingDays.has(day.day_number)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOptimizeDay(day.day_number);
                        }}
                      >
                        {optimizingDays.has(day.day_number)
                          ? t("optimizingRoute")
                          : t("optimizeDayRoute")}
                      </Button>
                    )}
                  </div>
                </div>
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
                  className={`transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="p-4 pt-0">
                <DayActivitiesList
                  day={day}
                  dayDate={calculateDayDate(itinerary.start_date, day.day_number)}
                  draggingActivityId={draggingActivityId}
                  crossDayDragInfo={crossDayDragInfo}
                  onActivityHover={onActivityHover}
                  onActivityClick={onActivityClick}
                />
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
