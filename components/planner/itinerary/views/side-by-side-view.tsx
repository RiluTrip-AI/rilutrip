/**
 * Side-by-Side View Component
 *
 * Displays all days in horizontal columns.
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
import type { SideBySideViewProps } from "../types";

export function SideBySideView({
  itinerary,
  draggingActivityId,
  crossDayDragInfo,
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
}: SideBySideViewProps) {
  const locale = useLocale();
  const t = useTranslations("planner");

  return (
    <div className="flex-1 overflow-x-auto overflow-y-auto">
      <div className="flex gap-4 p-4 min-w-max h-full">
        {itinerary.days.map((day) => {
          const formattedDate = formatDayHeader(
            calculateDayDate(itinerary.start_date, day.day_number),
            locale,
          );

          return (
            <div key={day.day_number} className="w-80 flex-shrink-0">
              <Card className="h-full flex flex-col">
                <CardHeader
                  className="p-4 border-b border-border"
                  onMouseEnter={() => onDayHover?.(day.day_number)}
                  onMouseLeave={() => onDayHover?.(null)}
                >
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">
                      {t("dayLabel", { day: day.day_number })}
                    </CardTitle>
                    {activityDurationOverloadedDays.has(day.day_number) && (
                      <span
                        className="text-xs text-amber-600 dark:text-amber-400 font-medium"
                        title={t("dayActivityDurationOverloaded")}
                      >
                        !
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{formattedDate}</p>
                  {activityDurationOverloadedDays.has(day.day_number) && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {t("dayActivityDurationOverloaded")}
                    </p>
                  )}
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
                      variant="outline"
                      size="sm"
                      className="w-full mt-1 h-7 text-xs"
                      disabled={optimizingDays.has(day.day_number)}
                      onClick={() => onOptimizeDay(day.day_number)}
                    >
                      {optimizingDays.has(day.day_number)
                        ? t("optimizingRoute")
                        : t("optimizeDayRoute")}
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="p-4 flex-1 overflow-y-auto">
                  <DayActivitiesList
                    day={day}
                    dayDate={calculateDayDate(itinerary.start_date, day.day_number)}
                    draggingActivityId={draggingActivityId}
                    crossDayDragInfo={crossDayDragInfo}
                    onActivityHover={onActivityHover}
                    onActivityClick={onActivityClick}
                  />
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
