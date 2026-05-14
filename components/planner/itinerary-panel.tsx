/**
 * Itinerary Panel Component
 *
 * Main orchestrator component for displaying and managing the itinerary.
 * Provides drag-and-drop functionality and multiple view modes.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 7.1, 7.2, 7.3, 7.4, 7.5
 */

"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  ActivityCard,
  PanelHeader,
  ChatToggleButton,
  ExpandableView,
  SingleDayView,
  SideBySideView,
  AddActivityDialog,
} from "./itinerary";
import type { ItineraryPanelProps, ViewMode } from "./itinerary";
import { useItineraryPermission } from "@/hooks/use-itinerary-permission";
import { useItineraryStore, OptimizeError, type OptimizeErrorKind } from "./itinerary/store";
import { useGlobalAddModeTracking } from "./itinerary/hooks/use-global-add-mode-tracking";
import { useAuth } from "@/lib/auth/auth-context";
import { useProfile } from "@/hooks/use-profile";
import { toast } from "sonner";

const OPTIMIZE_ERROR_I18N: Record<OptimizeErrorKind, string> = {
  INSUFFICIENT_CREDITS: "errorOptimizeInsufficientCredits",
  GENERIC: "errorOptimizeFailed",
};

export function ItineraryPanel({
  onFullscreenChange,
  onToggleChat,
  isChatOpen,
  viewMode: externalViewMode,
  onViewModeChange,
  currentDayIndex,
  onCurrentDayChange,
}: ItineraryPanelProps) {
  const t = useTranslations("planner");
  const tShare = useTranslations("share");
  const { canEdit, isReadOnly } = useItineraryPermission();
  const { session } = useAuth();
  const { refreshProfile } = useProfile();
  // Store state
  const committedItinerary = useItineraryStore((state) => state.itinerary);
  const previewItinerary = useItineraryStore((state) => state.previewItinerary);
  const access = useItineraryStore((state) => state.access);

  const itinerary = previewItinerary ?? committedItinerary;

  const draggingActivityId = useItineraryStore((state) => state.draggingActivityId);
  const crossDayDragInfo = useItineraryStore((state) => state.crossDayDragInfo);
  const setDraggingActivityId = useItineraryStore((state) => state.setDraggingActivityId);
  const setCrossDayDragInfo = useItineraryStore((state) => state.setCrossDayDragInfo);
  const handleDragOverAction = useItineraryStore((state) => state.handleDragOver);
  const startPreview = useItineraryStore((state) => state.startPreview);
  const applyPreview = useItineraryStore((state) => state.applyPreview);
  const discardPreview = useItineraryStore((state) => state.discardPreview);
  const resetDragState = useItineraryStore((state) => state.resetDragState);
  const setHoveredDay = useItineraryStore((state) => state.setHoveredDay);
  const setHoveredActivity = useItineraryStore((state) => state.setHoveredActivity);
  const setFocusedActivity = useItineraryStore((state) => state.setFocusedActivity);
  const isAddingActivity = useItineraryStore((state) => state.isAddingActivity);
  const setIsAddingActivity = useItineraryStore((state) => state.setIsAddingActivity);
  const addingActivityTarget = useItineraryStore((state) => state.addingActivityTarget);
  const setAddingActivityTarget = useItineraryStore((state) => state.setAddingActivityTarget);
  const setDayTimeWindow = useItineraryStore((state) => state.setDayTimeWindow);
  const setAllDaysTimeWindow = useItineraryStore((state) => state.setAllDaysTimeWindow);
  const setDayTransportMode = useItineraryStore((state) => state.setDayTransportMode);
  const setAllDaysTransportMode = useItineraryStore((state) => state.setAllDaysTransportMode);
  const optimizeDayRoutes = useItineraryStore((state) => state.optimizeDayRoutes);
  const getActivityDurationOverloadedDays = useItineraryStore(
    (state) => state.getActivityDurationOverloadedDays,
  );
  const optimizingDays = useItineraryStore((state) => state.optimizingDays);
  const activityDurationOverloadedDays = getActivityDurationOverloadedDays();
  const canOptimizeRoute =
    canEdit &&
    (Boolean(session?.access_token) ||
      access.source === "owner" ||
      access.source === "email_share");

  // Global mouse tracking for add activity mode
  useGlobalAddModeTracking();

  // View mode state
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>("side-by-side");
  const viewMode = externalViewMode ?? internalViewMode;
  const setViewMode = onViewModeChange ?? setInternalViewMode;

  // UI state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [collapsedDays, setCollapsedDays] = useState<Set<number>>(() => new Set());

  // Configure sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: isAddingActivity ? Infinity : 8,
      },
    }),
  );

  // Listen for Escape key to exit add mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isAddingActivity && !addingActivityTarget) {
        setIsAddingActivity(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAddingActivity, addingActivityTarget, setIsAddingActivity]);

  // Early return if no itinerary loaded
  if (!itinerary) {
    return null;
  }

  // UI handlers
  const expandedDays = new Set(
    itinerary.days
      .map((day) => day.day_number)
      .filter((dayNumber) => !collapsedDays.has(dayNumber)),
  );

  const toggleDay = (dayNumber: number) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayNumber)) {
        next.delete(dayNumber);
      } else {
        next.add(dayNumber);
      }
      return next;
    });
  };

  const goToPreviousDay = () => {
    const newIndex = Math.max(0, currentDayIndex - 1);
    onCurrentDayChange(newIndex);
  };

  const goToNextDay = () => {
    const newIndex = Math.min(itinerary.days.length - 1, currentDayIndex + 1);
    onCurrentDayChange(newIndex);
  };

  const toggleFullscreen = () => {
    const newFullscreenState = !isFullscreen;
    setIsFullscreen(newFullscreenState);
    onFullscreenChange?.(newFullscreenState);
  };

  // Drag and drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    setDraggingActivityId(event.active.id as string);
    setCrossDayDragInfo(null);
    startPreview();
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    const activeData = active.data.current;
    const overData = over?.data.current;

    handleDragOverAction(active, over, activeData, overData);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!event.over) {
      discardPreview();
      resetDragState();
      return;
    }

    try {
      await applyPreview();
    } catch (err) {
      console.error("Update days failed:", err);
      toast.error(t("errorUpdateDays"));
    }
  };

  const handleOptimizeDay = async (dayNumber: number) => {
    try {
      await optimizeDayRoutes([dayNumber]);
      refreshProfile().catch((err) => {
        console.error("Failed to refresh profile after route optimization:", err);
      });
    } catch (err) {
      const key =
        err instanceof OptimizeError ? OPTIMIZE_ERROR_I18N[err.kind] : "errorOptimizeFailed";
      toast.error(t(key));
    }
  };

  const handleDragCancel = () => {
    discardPreview();
    resetDragState();
  };

  // Get the active activity for drag overlay
  const activeActivity = draggingActivityId
    ? itinerary.days
        .flatMap((day) =>
          day.activities.map((activity) => ({
            activity,
            dayNumber: day.day_number,
          })),
        )
        .find(({ activity }) => activity.id === draggingActivityId)
    : null;

  // View renderers mapping
  const viewRenderers: Record<ViewMode, () => React.ReactElement | null> = {
    expandable: () => (
      <ExpandableView
        itinerary={itinerary}
        draggingActivityId={draggingActivityId}
        crossDayDragInfo={crossDayDragInfo}
        expandedDays={expandedDays}
        toggleDay={toggleDay}
        onDayHover={setHoveredDay}
        onActivityHover={setHoveredActivity}
        onActivityClick={setFocusedActivity}
        setDayTimeWindow={canEdit ? setDayTimeWindow : undefined}
        setAllDaysTimeWindow={canEdit ? setAllDaysTimeWindow : undefined}
        setDayTransportMode={canEdit ? setDayTransportMode : undefined}
        setAllDaysTransportMode={canEdit ? setAllDaysTransportMode : undefined}
        activityDurationOverloadedDays={activityDurationOverloadedDays}
        optimizingDays={optimizingDays}
        onOptimizeDay={canOptimizeRoute ? handleOptimizeDay : null}
      />
    ),
    "single-day": () => (
      <SingleDayView
        itinerary={itinerary}
        currentDayIndex={currentDayIndex}
        draggingActivityId={draggingActivityId}
        crossDayDragInfo={crossDayDragInfo}
        goToPreviousDay={goToPreviousDay}
        goToNextDay={goToNextDay}
        onActivityHover={setHoveredActivity}
        onActivityClick={setFocusedActivity}
        setDayTimeWindow={canEdit ? setDayTimeWindow : undefined}
        setAllDaysTimeWindow={canEdit ? setAllDaysTimeWindow : undefined}
        setDayTransportMode={canEdit ? setDayTransportMode : undefined}
        setAllDaysTransportMode={canEdit ? setAllDaysTransportMode : undefined}
        activityDurationOverloadedDays={activityDurationOverloadedDays}
        optimizingDays={optimizingDays}
        onOptimizeDay={canOptimizeRoute ? handleOptimizeDay : null}
      />
    ),
    "side-by-side": () => (
      <SideBySideView
        itinerary={itinerary}
        draggingActivityId={draggingActivityId}
        crossDayDragInfo={crossDayDragInfo}
        onDayHover={setHoveredDay}
        onActivityHover={setHoveredActivity}
        onActivityClick={setFocusedActivity}
        setDayTimeWindow={canEdit ? setDayTimeWindow : undefined}
        setAllDaysTimeWindow={canEdit ? setAllDaysTimeWindow : undefined}
        setDayTransportMode={canEdit ? setDayTransportMode : undefined}
        setAllDaysTransportMode={canEdit ? setAllDaysTransportMode : undefined}
        activityDurationOverloadedDays={activityDurationOverloadedDays}
        optimizingDays={optimizingDays}
        onOptimizeDay={canOptimizeRoute ? handleOptimizeDay : null}
      />
    ),
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="h-full flex flex-col bg-background">
        {/* Header */}
        <PanelHeader
          itinerary={itinerary}
          viewMode={viewMode}
          setViewMode={setViewMode}
          isFullscreen={isFullscreen}
          toggleFullscreen={toggleFullscreen}
        />

        {isReadOnly && (
          <div className="group relative flex items-center justify-center overflow-hidden border-b border-border bg-background/50 px-4 py-2.5 backdrop-blur-md z-10 transition-colors">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <div className="flex items-center gap-2.5 relative z-10">
              <span className="text-sm font-medium tracking-wide text-foreground/90">
                {tShare("readOnlyBanner")}
              </span>
            </div>
          </div>
        )}

        {/* Content based on view mode */}
        {viewRenderers[viewMode]()}

        {/* Chat Toggle Button */}
        <ChatToggleButton onToggleChat={onToggleChat} isChatOpen={isChatOpen} />
      </div>

      {/* Add Activity Dialog */}
      {canEdit && addingActivityTarget && (
        <AddActivityDialog
          isOpen={true}
          dayNumber={addingActivityTarget.dayNumber}
          insertionIndex={addingActivityTarget.insertionIndex}
          onClose={() => setAddingActivityTarget(null)}
        />
      )}

      {/* Drag Overlay - Shows the dragged item following the cursor */}
      <DragOverlay>
        {activeActivity && (
          <ActivityCard
            activity={activeActivity.activity}
            className="shadow-2xl border-b-4 border-r-4 border-b-primary border-r-primary opacity-90"
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
