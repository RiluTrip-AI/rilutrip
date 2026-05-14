/**
 * Type definitions for Itinerary Panel components
 */

import type { Itinerary, Activity, Day, OptimizeWarning, TransportMode } from "@/types/itinerary";

export type ViewMode = "expandable" | "single-day" | "side-by-side";

export interface DroppableDayProps {
  dayNumber: number;
  isOver?: boolean;
}

export interface DayActivitiesListProps {
  day: Day;
  dayDate: string;
  draggingActivityId: string | null;
  crossDayDragInfo: { sourceDayNumber: number; targetDayNumber: number } | null;
  onActivityHover?: (activityId: string | null) => void;
  onActivityClick?: (activityId: string) => void;
}

export interface ActivityCardProps {
  activity: Activity;
  dayDate?: string;
  className?: string;
  optimizeWarning?: OptimizeWarning;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: () => void;
}

export interface SortableActivityProps {
  activity: Activity;
  dayNumber: number;
  dayDate: string;
  onActivityHover?: (activityId: string | null) => void;
  onActivityClick?: (activityId: string) => void;
  disableAnimation?: boolean;
}

export interface ItineraryPanelProps {
  onFullscreenChange?: (isFullscreen: boolean) => void;
  onToggleChat?: () => void;
  isChatOpen?: boolean;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  currentDayIndex: number;
  onCurrentDayChange: (dayIndex: number) => void;
}

export interface PanelHeaderProps {
  itinerary: Itinerary;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
}

export interface ChatToggleButtonProps {
  onToggleChat?: () => void;
  isChatOpen?: boolean;
}

export interface ExpandableViewProps {
  itinerary: Itinerary;
  draggingActivityId: string | null;
  crossDayDragInfo: { sourceDayNumber: number; targetDayNumber: number } | null;
  expandedDays: Set<number>;
  toggleDay: (dayNumber: number) => void;
  onDayHover?: (dayNumber: number | null) => void;
  onActivityHover?: (activityId: string | null) => void;
  onActivityClick?: (activityId: string) => void;
  setDayTimeWindow?: (dayNumber: number, startTime: string, endTime: string) => Promise<void>;
  setAllDaysTimeWindow?: (startTime: string, endTime: string) => Promise<void>;
  setDayTransportMode?: (dayNumber: number, mode: TransportMode) => Promise<void>;
  setAllDaysTransportMode?: (mode: TransportMode) => Promise<void>;
  activityDurationOverloadedDays: Set<number>;
  optimizingDays: Set<number>;
  onOptimizeDay: ((dayNumber: number) => void) | null;
}

export interface SingleDayViewProps {
  itinerary: Itinerary;
  currentDayIndex: number;
  draggingActivityId: string | null;
  crossDayDragInfo: { sourceDayNumber: number; targetDayNumber: number } | null;
  goToPreviousDay: () => void;
  goToNextDay: () => void;
  onActivityHover?: (activityId: string | null) => void;
  onActivityClick?: (activityId: string) => void;
  setDayTimeWindow?: (dayNumber: number, startTime: string, endTime: string) => Promise<void>;
  setAllDaysTimeWindow?: (startTime: string, endTime: string) => Promise<void>;
  setDayTransportMode?: (dayNumber: number, mode: TransportMode) => Promise<void>;
  setAllDaysTransportMode?: (mode: TransportMode) => Promise<void>;
  activityDurationOverloadedDays: Set<number>;
  optimizingDays: Set<number>;
  onOptimizeDay: ((dayNumber: number) => void) | null;
}

export interface SideBySideViewProps {
  itinerary: Itinerary;
  draggingActivityId: string | null;
  crossDayDragInfo: { sourceDayNumber: number; targetDayNumber: number } | null;
  onDayHover?: (dayNumber: number | null) => void;
  onActivityHover?: (activityId: string | null) => void;
  onActivityClick?: (activityId: string) => void;
  setDayTimeWindow?: (dayNumber: number, startTime: string, endTime: string) => Promise<void>;
  setAllDaysTimeWindow?: (startTime: string, endTime: string) => Promise<void>;
  setDayTransportMode?: (dayNumber: number, mode: TransportMode) => Promise<void>;
  setAllDaysTransportMode?: (mode: TransportMode) => Promise<void>;
  activityDurationOverloadedDays: Set<number>;
  optimizingDays: Set<number>;
  onOptimizeDay: ((dayNumber: number) => void) | null;
}
