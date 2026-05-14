/**
 * Sortable Activity Component
 *
 * Wraps ActivityCard with dnd-kit sortable functionality for drag-and-drop.
 */

"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ActivityCard } from "./activity-card";
import { useItineraryPermission } from "@/hooks/use-itinerary-permission";
import type { SortableActivityProps } from "../types";
import { useItineraryStore } from "../store";

export function SortableActivity({
  activity,
  dayNumber,
  dayDate,
  onActivityHover,
  onActivityClick,
  disableAnimation,
}: SortableActivityProps) {
  const { canEdit } = useItineraryPermission();
  const optimizeWarning = useItineraryStore((s) => s.optimizeWarnings.get(activity.id));
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: activity.id,
    disabled: !canEdit,
    data: {
      activity,
      dayNumber,
    },
    transition: disableAnimation
      ? null
      : {
          duration: 200,
          easing: "cubic-bezier(0.25, 1, 0.5, 1)",
        },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: disableAnimation ? "none" : transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-activity-card="true"
      {...(canEdit ? attributes : {})}
      {...(canEdit ? listeners : {})}
    >
      <ActivityCard
        activity={activity}
        dayDate={dayDate}
        optimizeWarning={optimizeWarning}
        className={`mb-3 transition-all border-b-4 border-r-4 border-b-primary/40 border-r-primary/40 hover:border-b-primary hover:border-r-primary ${
          isDragging
            ? "shadow-2xl cursor-grabbing"
            : canEdit
              ? "hover:shadow-md cursor-grab"
              : "hover:shadow-md"
        }`}
        onMouseEnter={() => onActivityHover?.(activity.id)}
        onMouseLeave={() => onActivityHover?.(null)}
        onClick={() => onActivityClick?.(activity.id)}
      />
    </div>
  );
}
