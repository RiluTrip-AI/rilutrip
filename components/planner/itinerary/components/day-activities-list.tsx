/**
 * Day Activities List Component
 *
 * Renders a list of activities for a day, handling both empty and populated states.
 * Includes add-mode placeholder rendering driven by global mouse tracking.
 */

"use client";

import { useMemo, useCallback, Fragment, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Car, PersonStanding, Bus, Bike } from "lucide-react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { DroppableDay } from "./droppable-day";
import { SortableActivity } from "./sortable-activity";
import { ActivityPlaceholderCard } from "./activity-placeholder-card";
import { useItineraryStore } from "../store";
import { useItineraryPermission } from "@/hooks/use-itinerary-permission";
import type { DayActivitiesListProps } from "../types";
import type { TransportMode } from "@/types/itinerary";

const TRANSPORT_ICONS: Record<TransportMode, React.ElementType> = {
  driving: Car,
  walking: PersonStanding,
  transit: Bus,
  bicycling: Bike,
};

function normalizeCoordinate(value: number | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(6) : null;
}

async function sha256Hex(payload: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getLocationFingerprintPayload(
  activities: DayActivitiesListProps["day"]["activities"],
  activityIds: string[],
): string | null {
  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const payload = activityIds
    .map((id) => {
      const activity = byId.get(id);
      if (!activity) return null;
      return {
        id: activity.id,
        place_id: activity.location.place_id ?? null,
        lat: normalizeCoordinate(activity.location.lat),
        lng: normalizeCoordinate(activity.location.lng),
      };
    })
    .filter((activity): activity is NonNullable<typeof activity> => activity !== null)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (payload.length !== activityIds.length) return null;
  return JSON.stringify(payload);
}

export function DayActivitiesList({
  day,
  dayDate,
  draggingActivityId,
  crossDayDragInfo,
  onActivityHover,
  onActivityClick,
}: DayActivitiesListProps) {
  const { canEdit } = useItineraryPermission();
  const tTransit = useTranslations("transit");
  const tWarnings = useTranslations("planner.routeWarnings");
  const activities = day.activities;
  const itemIds = useMemo(() => activities.map((activity) => activity.id), [activities]);
  const optimizeWarnings = useItineraryStore((s) => s.optimizeWarnings);
  const scheduledActivities = useMemo(
    () => activities.filter((activity) => !optimizeWarnings.has(activity.id)),
    [activities, optimizeWarnings],
  );
  const unscheduledActivities = useMemo(
    () => activities.filter((activity) => optimizeWarnings.has(activity.id)),
    [activities, optimizeWarnings],
  );

  const storedDayMatrix = useItineraryStore((s) => s.dayMatrices.get(day.day_number));
  const [currentMatrixFingerprint, setCurrentMatrixFingerprint] = useState<{
    payload: string;
    fingerprint: string | null;
  } | null>(null);
  const matrixActivitiesPresent = useMemo(
    () =>
      storedDayMatrix
        ? storedDayMatrix.activityIds.every((id) =>
            activities.some((activity) => activity.id === id),
          )
        : false,
    [activities, storedDayMatrix],
  );
  const matrixFingerprintPayload = useMemo(
    () =>
      storedDayMatrix && matrixActivitiesPresent
        ? getLocationFingerprintPayload(activities, storedDayMatrix.activityIds)
        : null,
    [activities, matrixActivitiesPresent, storedDayMatrix],
  );

  useEffect(() => {
    let cancelled = false;
    if (!matrixFingerprintPayload) return;

    sha256Hex(matrixFingerprintPayload).then((fingerprint) => {
      if (!cancelled) {
        setCurrentMatrixFingerprint({ payload: matrixFingerprintPayload, fingerprint });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [matrixFingerprintPayload]);

  const dayMatrix =
    storedDayMatrix &&
    storedDayMatrix.transportMode === day.transport_mode &&
    (!matrixActivitiesPresent ||
      (currentMatrixFingerprint?.payload === matrixFingerprintPayload &&
        currentMatrixFingerprint.fingerprint === storedDayMatrix.locationFingerprint))
      ? storedDayMatrix
      : undefined;
  const ModeIcon = TRANSPORT_ICONS[day.transport_mode];

  const getTravelMinutes = useCallback(
    (fromId: string, toId: string): number | null => {
      if (!dayMatrix) return null;
      const fromIdx = dayMatrix.activityIds.indexOf(fromId);
      const toIdx = dayMatrix.activityIds.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return null;
      return dayMatrix.matrix[fromIdx]?.[toIdx] ?? null;
    },
    [dayMatrix],
  );

  // Add mode state
  const isAddMode = useItineraryStore((s) => s.isAddingActivity);
  const addModePlaceholder = useItineraryStore((s) => s.addModePlaceholder);
  const setIsAddingActivity = useItineraryStore((s) => s.setIsAddingActivity);
  const setAddingActivityTarget = useItineraryStore((s) => s.setAddingActivityTarget);

  const placeholderIndex =
    canEdit && isAddMode && addModePlaceholder?.dayNumber === day.day_number
      ? addModePlaceholder.insertionIndex
      : null;

  const handlePlaceholderClick = useCallback(() => {
    setAddingActivityTarget({
      dayNumber: day.day_number,
      insertionIndex: placeholderIndex ?? 0,
    });
    setIsAddingActivity(false);
  }, [day.day_number, placeholderIndex, setAddingActivityTarget, setIsAddingActivity]);

  // Empty day
  if (activities.length === 0) {
    const showPlaceholder = canEdit && isAddMode && placeholderIndex !== null;
    return (
      <div data-day-list={day.day_number}>
        {showPlaceholder ? (
          <ActivityPlaceholderCard onClick={handlePlaceholderClick} />
        ) : (
          <DroppableDay
            dayNumber={day.day_number}
            isOver={
              draggingActivityId !== null && crossDayDragInfo?.targetDayNumber === day.day_number
            }
          />
        )}
      </div>
    );
  }

  // Day with activities
  return (
    <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
      <div data-day-list={day.day_number} className="space-y-0">
        {scheduledActivities.map((activity, i) => {
          const nextActivity = scheduledActivities[i + 1];
          const travelMinutes =
            nextActivity && !isAddMode && draggingActivityId === null
              ? getTravelMinutes(activity.id, nextActivity.id)
              : null;

          return (
            <Fragment key={activity.id}>
              {canEdit && isAddMode && placeholderIndex === i && (
                <ActivityPlaceholderCard onClick={handlePlaceholderClick} />
              )}
              <SortableActivity
                activity={activity}
                dayNumber={day.day_number}
                dayDate={dayDate}
                onActivityHover={onActivityHover}
                onActivityClick={onActivityClick}
                disableAnimation={crossDayDragInfo?.targetDayNumber === day.day_number}
              />
              {travelMinutes !== null && (
                <div className="flex items-center justify-center gap-1 py-0.5 text-muted-foreground/60">
                  <ModeIcon className="h-3 w-3" aria-hidden="true" />
                  <span className="text-[10px]">
                    {travelMinutes} {tTransit("minutes")}
                  </span>
                </div>
              )}
            </Fragment>
          );
        })}
        {unscheduledActivities.length > 0 && (
          <div className="my-3 flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
            <div className="h-px flex-1 bg-amber-200 dark:bg-amber-500/40" />
            <span className="shrink-0">{tWarnings("unscheduledSection")}</span>
            <div className="h-px flex-1 bg-amber-200 dark:bg-amber-500/40" />
          </div>
        )}
        {unscheduledActivities.map((activity) => (
          <SortableActivity
            key={activity.id}
            activity={activity}
            dayNumber={day.day_number}
            dayDate={dayDate}
            onActivityHover={onActivityHover}
            onActivityClick={onActivityClick}
            disableAnimation={crossDayDragInfo?.targetDayNumber === day.day_number}
          />
        ))}
        {canEdit && isAddMode && placeholderIndex === activities.length && (
          <ActivityPlaceholderCard onClick={handlePlaceholderClick} />
        )}
      </div>
    </SortableContext>
  );
}
