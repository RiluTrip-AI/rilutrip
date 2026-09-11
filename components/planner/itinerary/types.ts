/**
 * Type definitions for Itinerary Panel components
 */

import type { Itinerary, Activity, Day, TransportMode } from "@/types/itinerary";
import type { OptimizeDayResult } from "./store";

export type ViewMode = "expandable" | "single-day" | "side-by-side";

export interface DroppableDayProps {
  dayNumber: number;
  isOver?: boolean;
}

export interface DayActivitiesListProps {
  day: Day;
  draggingActivityId: string | null;
  crossDayDragInfo: { sourceDayNumber: number; targetDayNumber: number } | null;
  onActivityHover?: (activityId: string | null) => void;
  onActivityClick?: (activityId: string) => void;
}

export interface ActivityCardProps {
  activity: Activity;
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: () => void;
}

export interface SortableActivityProps {
  activity: Activity;
  dayNumber: number;
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
  optimizeDay?: (dayNumber: number) => Promise<OptimizeDayResult>;
  optimizingDays: Set<number>;
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
  optimizeDay?: (dayNumber: number) => Promise<OptimizeDayResult>;
  optimizingDays: Set<number>;
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
  optimizeDay?: (dayNumber: number) => Promise<OptimizeDayResult>;
  optimizingDays: Set<number>;
}
