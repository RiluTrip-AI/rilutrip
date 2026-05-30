import { create } from "zustand";
import type { Itinerary, Activity, TransportMode } from "@/types/itinerary";
import type { AccessContext } from "@/types/share";
import type { Active, Over } from "@dnd-kit/core";
import { calculateDragOverUpdate } from "./utils/drag-handlers";
import {
  ItineraryUnavailableError,
  loadItinerary,
  updateItinerary,
} from "@/lib/supabase/itineraries";
import { getEffectivePermission } from "@/lib/supabase/shares";
import { applyOperations, type OperationsUpdate } from "@/lib/ai/operations";
import { aiClient, ApiError } from "@/lib/ai/client";
import { calcDayCount } from "@/lib/utils/date";
import { adjustDays } from "@/lib/utils/itinerary";
import { resolvePlaceDetails, type ResolveStatus } from "@/lib/places/place-resolver";

let pollingIntervalHandle: ReturnType<typeof setInterval> | null = null;

const MAX_HISTORY_ENTRIES = 50;
type ItineraryErrorKind = "access" | "load" | "runtime" | null;

interface ItineraryState {
  // Data State
  itinerary: Itinerary | null;
  isLoading: boolean;
  errorKind: ItineraryErrorKind;
  errorCode: string | null;
  historyPast: Itinerary[];
  historyFuture: Itinerary[];
  access: AccessContext;

  // Generation State
  isGenerating: boolean;
  isSaving: boolean;
  saveError: boolean;
  generationAbortController: AbortController | null;

  // Interaction State
  previewBaseItinerary: Itinerary | null;
  previewItinerary: Itinerary | null;

  crossDayDragInfo: { sourceDayNumber: number; targetDayNumber: number } | null;
  draggingActivityId: string | null;

  hoveredDayNumber: number | null;
  hoveredActivityId: string | null;
  selectedDayNumber: number | null;
  selectedActivityId: string | null;
  focusedActivityId: string | null;

  // Add Activity Mode State
  isAddingActivity: boolean;
  addingActivityTarget: { dayNumber: number; insertionIndex: number } | null;
  addModePlaceholder: { dayNumber: number; insertionIndex: number } | null;

  // Data Actions
  fetchItinerary: (id: string) => Promise<void>;
  commitItineraryChange: (nextItinerary: Itinerary) => Promise<void>;
  applyRemoteChange: (nextItinerary: Itinerary) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canEdit: () => boolean;
  canDelete: () => boolean;
  canShare: () => boolean;
  getCanUndo: () => boolean;
  getCanRedo: () => boolean;
  startPreview: (baseItinerary?: Itinerary) => void;
  updatePreview: (nextItinerary: Itinerary) => void;
  applyPreview: () => Promise<void>;
  discardPreview: () => void;
  resetDragState: () => void;
  updateMetadata: (
    updates: Partial<
      Pick<Itinerary, "title" | "destination" | "start_date" | "end_date" | "description">
    >,
  ) => Promise<void>;
  addActivity: (
    dayNumber: number,
    activityInput: {
      title: string;
      locationName: string;
      time: string;
      duration: number;
      note?: string;
    },
    insertionIndex?: number,
  ) => Promise<{ resolveStatus: ResolveStatus }>;
  updateActivity: (
    activityId: string,
    activityInput: {
      title: string;
      locationName: string;
      time: string;
      duration: number;
      note?: string;
    },
  ) => Promise<{ resolveStatus: ResolveStatus }>;
  deleteActivity: (activityId: string) => Promise<void>;

  setDayTimeWindow: (dayNumber: number, startTime: string, endTime: string) => Promise<void>;
  setAllDaysTimeWindow: (startTime: string, endTime: string) => Promise<void>;

  setDayTransportMode: (dayNumber: number, mode: TransportMode) => Promise<void>;
  setAllDaysTransportMode: (mode: TransportMode) => Promise<void>;

  // Generation Actions
  startGeneration: (itineraryId: string, locale: string, onComplete?: () => void) => void;
  stopGeneration: () => void;
  applyOperations: (ops: OperationsUpdate) => Promise<void>;

  // Drag & Drop Actions
  handleDragOver: (
    active: Active,
    over: Over | null,
    activeData: unknown,
    overData: unknown,
  ) => void;
  setCrossDayDragInfo: (info: { sourceDayNumber: number; targetDayNumber: number } | null) => void;
  setDraggingActivityId: (id: string | null) => void;

  // Hover & Focus State Actions
  setHoveredDay: (dayNumber: number | null) => void;
  setHoveredActivity: (activityId: string | null) => void;
  setSelectedDay: (dayNumber: number | null) => void;
  setSelectedActivity: (activityId: string | null) => void;
  setFocusedActivity: (activityId: string | null) => void;

  // Add Activity Mode Actions
  setIsAddingActivity: (flag: boolean) => void;
  setAddingActivityTarget: (target: { dayNumber: number; insertionIndex: number } | null) => void;
  setAddModePlaceholder: (
    placeholder: { dayNumber: number; insertionIndex: number } | null,
  ) => void;
}

export const useItineraryStore = create<ItineraryState>((set, get) => ({
  // Initial State
  itinerary: null,
  isLoading: false,
  errorKind: null,
  errorCode: null,
  historyPast: [],
  historyFuture: [],
  access: { permission: "none", source: null },
  isGenerating: false,
  isSaving: false,
  saveError: false,
  generationAbortController: null,
  previewBaseItinerary: null,
  previewItinerary: null,
  crossDayDragInfo: null,
  draggingActivityId: null,
  hoveredDayNumber: null,
  hoveredActivityId: null,
  selectedDayNumber: null,
  selectedActivityId: null,
  focusedActivityId: null,
  isAddingActivity: false,
  addingActivityTarget: null,
  addModePlaceholder: null,

  // Basic Setters
  setCrossDayDragInfo: (info) => set({ crossDayDragInfo: info }),
  setDraggingActivityId: (id) => set({ draggingActivityId: id }),
  setHoveredDay: (dayNumber) => {
    set({ hoveredDayNumber: dayNumber });
  },
  setHoveredActivity: (activityId) => {
    set({ hoveredActivityId: activityId });
  },
  setSelectedDay: (dayNumber) => {
    set({ selectedDayNumber: dayNumber });
  },
  setSelectedActivity: (activityId) => {
    set({ selectedActivityId: activityId });
  },
  setFocusedActivity: (activityId) => {
    if (activityId) {
      set({
        focusedActivityId: activityId,
        selectedActivityId: activityId,
      });
    } else {
      set({ focusedActivityId: null });
    }
  },
  setIsAddingActivity: (flag) =>
    set({
      isAddingActivity: flag,
      ...(flag ? {} : { addModePlaceholder: null }),
    }),
  setAddingActivityTarget: (target) => set({ addingActivityTarget: target }),
  setAddModePlaceholder: (placeholder) => set({ addModePlaceholder: placeholder }),

  canEdit: () => {
    const { access } = get();
    return access.permission === "owner" || access.permission === "edit";
  },

  canDelete: () => {
    const { access } = get();
    return access.permission === "owner";
  },

  canShare: () => {
    const { access } = get();
    return access.permission === "owner";
  },

  // Fetch Action
  fetchItinerary: async (id: string) => {
    set({ isLoading: true, errorKind: null, errorCode: null });
    try {
      const data = await loadItinerary(id);
      const access = await getEffectivePermission(data.id, data.user_id, data.link_access);

      set({
        itinerary: data,
        access,
        historyPast: [],
        historyFuture: [],
        previewBaseItinerary: null,
        previewItinerary: null,
      });
    } catch (err) {
      if (err instanceof ItineraryUnavailableError) {
        set({ errorKind: "access", errorCode: "ITINERARY_UNAVAILABLE" });
      } else {
        console.error("Failed to load itinerary:", err);
        set({
          errorKind: "load",
          errorCode: "LOAD_FAILED",
        });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  commitItineraryChange: async (nextItinerary) => {
    const state = get();
    const currentItinerary = state.itinerary;
    if (!currentItinerary) return;

    const payload: Partial<Itinerary> = {
      title: nextItinerary.title,
      destination: nextItinerary.destination,
      start_date: nextItinerary.start_date,
      end_date: nextItinerary.end_date,
      description: nextItinerary.description,
      days: nextItinerary.days,
    };

    const nextPast = [...state.historyPast, cloneItinerarySnapshot(currentItinerary)].slice(
      -MAX_HISTORY_ENTRIES,
    );

    set({
      itinerary: nextItinerary,
      historyPast: nextPast,
      historyFuture: [],
    });

    try {
      const updated = await updateItinerary(currentItinerary.id, payload, state.access);
      set({ itinerary: updated });
    } catch (err) {
      console.error("Failed to commit itinerary:", err);
      set({
        itinerary: currentItinerary,
        historyPast: state.historyPast,
        historyFuture: state.historyFuture,
      });
      throw err;
    }
  },

  applyRemoteChange: (nextItinerary) => {
    const state = get();
    const currentItinerary = state.itinerary;
    if (!currentItinerary) return;

    // Remote changes don't go into undo/redo history
    // They just update the current state
    set({ itinerary: nextItinerary });
  },

  undo: async () => {
    const state = get();
    const currentItinerary = state.itinerary;
    const previousItinerary = state.historyPast[state.historyPast.length - 1];

    if (!currentItinerary || !previousItinerary) return;

    const nextPast = state.historyPast.slice(0, -1);
    const nextFuture = [cloneItinerarySnapshot(currentItinerary), ...state.historyFuture];
    const payload: Partial<Itinerary> = {
      title: previousItinerary.title,
      destination: previousItinerary.destination,
      start_date: previousItinerary.start_date,
      end_date: previousItinerary.end_date,
      description: previousItinerary.description,
      days: previousItinerary.days,
    };

    get().discardPreview();
    get().resetDragState();

    set({
      itinerary: previousItinerary,
      historyPast: nextPast,
      historyFuture: nextFuture,
      isSaving: true,
      saveError: false,
    });

    try {
      const updated = await updateItinerary(currentItinerary.id, payload, state.access);
      set({ itinerary: updated });
    } catch (err) {
      console.error("Failed to undo itinerary change:", err);
      set({
        itinerary: currentItinerary,
        historyPast: state.historyPast,
        historyFuture: state.historyFuture,
        saveError: true,
      });
      throw err;
    } finally {
      set({ isSaving: false });
    }
  },

  redo: async () => {
    const state = get();
    const currentItinerary = state.itinerary;
    const nextItinerary = state.historyFuture[0];

    if (!currentItinerary || !nextItinerary || state.isGenerating) return;

    const nextPast = [...state.historyPast, cloneItinerarySnapshot(currentItinerary)];
    const nextFuture = state.historyFuture.slice(1);
    const payload: Partial<Itinerary> = {
      title: nextItinerary.title,
      destination: nextItinerary.destination,
      start_date: nextItinerary.start_date,
      end_date: nextItinerary.end_date,
      description: nextItinerary.description,
      days: nextItinerary.days,
    };

    get().discardPreview();
    get().resetDragState();

    set({
      itinerary: nextItinerary,
      historyPast: nextPast,
      historyFuture: nextFuture,
      isSaving: true,
      saveError: false,
    });

    try {
      const updated = await updateItinerary(currentItinerary.id, payload, state.access);
      set({ itinerary: updated });
    } catch (err) {
      console.error("Failed to redo itinerary change:", err);
      set({
        itinerary: currentItinerary,
        historyPast: state.historyPast,
        historyFuture: state.historyFuture,
        saveError: true,
      });
      throw err;
    } finally {
      set({ isSaving: false });
    }
  },

  getCanUndo: () => get().historyPast.length > 0,
  getCanRedo: () => get().historyFuture.length > 0,

  startPreview: (baseItinerary) => {
    const state = get();
    const previewBase = baseItinerary ?? state.itinerary;
    if (!previewBase) return;

    set({
      previewBaseItinerary: cloneItinerarySnapshot(previewBase),
      previewItinerary: cloneItinerarySnapshot(previewBase),
    });
  },

  updatePreview: (nextItinerary) => {
    set({ previewItinerary: nextItinerary });
  },

  applyPreview: async () => {
    const state = get();
    const previewItinerary = state.previewItinerary;
    const previewBaseItinerary = state.previewBaseItinerary;

    if (!previewItinerary || !previewBaseItinerary) {
      get().discardPreview();
      get().resetDragState();
      return;
    }

    if (serializeItinerary(previewBaseItinerary) === serializeItinerary(previewItinerary)) {
      get().discardPreview();
      get().resetDragState();
      return;
    }

    set({ isSaving: true, saveError: false });
    try {
      await get().commitItineraryChange(previewItinerary);
    } catch (err) {
      set({ saveError: true });
      throw err;
    } finally {
      get().discardPreview();
      get().resetDragState();
      set({ isSaving: false });
    }
  },

  discardPreview: () =>
    set({
      previewBaseItinerary: null,
      previewItinerary: null,
    }),

  resetDragState: () =>
    set({
      crossDayDragInfo: null,
      draggingActivityId: null,
    }),

  // Update Metadata
  updateMetadata: async (updates) => {
    const state = get();
    const currentItinerary = state.itinerary;
    if (!currentItinerary) return;

    // Determine whether the trip length is changing
    const newStart = updates.start_date ?? currentItinerary.start_date;
    const newEnd = updates.end_date ?? currentItinerary.end_date;
    const oldDayCount = calcDayCount(currentItinerary.start_date, currentItinerary.end_date);
    const newDayCount = calcDayCount(newStart, newEnd);

    const nextItinerary: Itinerary = {
      ...currentItinerary,
      title: updates.title ?? currentItinerary.title,
      destination: updates.destination ?? currentItinerary.destination,
      start_date: newStart,
      end_date: newEnd,
      description:
        updates.description !== undefined ? updates.description : currentItinerary.description,
      days:
        newDayCount !== oldDayCount
          ? adjustDays(currentItinerary.days, newDayCount)
          : currentItinerary.days,
    };

    if (serializeItinerary(currentItinerary) === serializeItinerary(nextItinerary)) {
      return;
    }

    set({ isSaving: true, saveError: false });
    try {
      await get().commitItineraryChange(nextItinerary);
    } catch (err) {
      console.error("Failed to update itinerary metadata:", err);
      set({ saveError: true });
      throw err;
    } finally {
      set({ isSaving: false });
    }
  },

  // AI Operations Action
  applyOperations: async (ops: OperationsUpdate) => {
    const state = get();
    const currentItinerary = state.itinerary;
    if (!currentItinerary) return;

    // 1. 本地透過 AI operations 計算出預期的 itinerary 狀態
    const optimisticItinerary = await applyOperations(currentItinerary, ops);

    set({ isSaving: true, saveError: false });
    try {
      await get().commitItineraryChange(optimisticItinerary);
    } catch (err) {
      console.error("Failed to apply AI operations:", err);
      set({ saveError: true });
      throw err;
    } finally {
      set({ isSaving: false });
    }
  },

  // Add Single Activity
  addActivity: async (dayNumber, activityInput, insertionIndex?: number) => {
    const state = get();
    if (!state.itinerary) return { resolveStatus: "success" };

    set({ isSaving: true, saveError: false });
    try {
      // Resolve location data
      const { status: resolveStatus, location: resolvedLocation } = await resolvePlaceDetails({
        name: activityInput.locationName,
      });

      // Create activity object
      const activity: Activity = {
        id: crypto.randomUUID(),
        title: activityInput.title,
        location: resolvedLocation,
        note: activityInput.note || "",
        time: activityInput.time,
        duration_minutes: activityInput.duration,
        order: insertionIndex ?? 0,
      };

      const days = state.itinerary.days.map((day) =>
        day.day_number === dayNumber
          ? {
              ...day,
              activities:
                insertionIndex !== undefined &&
                insertionIndex >= 0 &&
                insertionIndex <= day.activities.length
                  ? [
                      ...day.activities.slice(0, insertionIndex),
                      activity,
                      ...day.activities.slice(insertionIndex),
                    ]
                  : [...day.activities, activity],
            }
          : day,
      );

      await get().commitItineraryChange({
        ...state.itinerary,
        days,
        updated_at: new Date().toISOString(),
      });
      get().setHoveredActivity(activity.id);
      return { resolveStatus };
    } catch (err) {
      console.error("Failed to add activity:", err);
      set({ saveError: true });
      throw err;
    } finally {
      set({ isSaving: false });
    }
  },

  // Update Single Activity
  updateActivity: async (activityId, activityInput) => {
    const state = get();
    if (!state.itinerary) return { resolveStatus: "success" };

    let existingActivity: Activity | undefined;
    for (const day of state.itinerary.days) {
      existingActivity = day.activities.find((a) => a.id === activityId);
      if (existingActivity) break;
    }

    if (!existingActivity) {
      throw new Error("Activity not found");
    }

    const isDirty =
      activityInput.title !== existingActivity.title ||
      activityInput.locationName !== existingActivity.location.name ||
      (activityInput.note || "") !== (existingActivity.note || "") ||
      activityInput.time !== existingActivity.time ||
      activityInput.duration !== existingActivity.duration_minutes;

    if (!isDirty) return { resolveStatus: "success" };

    set({ isSaving: true, saveError: false });
    try {
      let resolvedLocation = existingActivity.location;
      let resolveStatus: ResolveStatus = "success";
      if (activityInput.locationName !== existingActivity.location.name) {
        const resolved = await resolvePlaceDetails({
          name: activityInput.locationName,
        });
        resolvedLocation = resolved.location;
        resolveStatus = resolved.status;
      }

      // Create updated activity object
      const updatedActivity: Activity = {
        ...existingActivity,
        title: activityInput.title,
        location: resolvedLocation,
        note: activityInput.note || "",
        time: activityInput.time,
        duration_minutes: activityInput.duration,
      };

      const newDays = state.itinerary.days.map((day) => ({
        ...day,
        activities: day.activities.map((activity) =>
          activity.id === activityId ? updatedActivity : activity,
        ),
      }));

      await get().commitItineraryChange({
        ...state.itinerary,
        days: newDays,
        updated_at: new Date().toISOString(),
      });
      get().setHoveredActivity(activityId);
      return { resolveStatus };
    } catch (err) {
      console.error("Failed to update activity:", err);
      set({ saveError: true });
      throw err;
    } finally {
      set({ isSaving: false });
    }
  },

  // Delete Single Activity
  deleteActivity: async (activityId) => {
    const state = get();
    if (!state.itinerary) return;

    set({ isSaving: true, saveError: false });
    try {
      const newDays = state.itinerary.days.map((day) => ({
        ...day,
        activities: day.activities.filter((activity) => activity.id !== activityId),
      }));

      await get().commitItineraryChange({
        ...state.itinerary,
        days: newDays,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Failed to delete activity:", err);
      set({ saveError: true });
      throw err;
    } finally {
      set({ isSaving: false });
    }
  },

  setDayTimeWindow: async (dayNumber, startTime, endTime) => {
    const state = get();
    if (!state.itinerary) return;
    set({ isSaving: true, saveError: false });
    try {
      const newDays = state.itinerary.days.map((d) =>
        d.day_number === dayNumber ? { ...d, start_time: startTime, end_time: endTime } : d,
      );
      await get().commitItineraryChange({
        ...state.itinerary,
        days: newDays,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Failed to set day time window:", err);
      set({ saveError: true });
      throw err;
    } finally {
      set({ isSaving: false });
    }
  },

  setAllDaysTimeWindow: async (startTime, endTime) => {
    const state = get();
    if (!state.itinerary) return;
    set({ isSaving: true, saveError: false });
    try {
      const newDays = state.itinerary.days.map((d) => ({
        ...d,
        start_time: startTime,
        end_time: endTime,
      }));
      await get().commitItineraryChange({
        ...state.itinerary,
        days: newDays,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Failed to set all days time window:", err);
      set({ saveError: true });
      throw err;
    } finally {
      set({ isSaving: false });
    }
  },

  setDayTransportMode: async (dayNumber, mode) => {
    const state = get();
    if (!state.itinerary) return;
    const currentDay = state.itinerary.days.find((d) => d.day_number === dayNumber);
    if (currentDay?.transport_mode === mode) return;
    set({ isSaving: true, saveError: false });
    try {
      const newDays = state.itinerary.days.map((d) =>
        d.day_number === dayNumber ? { ...d, transport_mode: mode } : d,
      );
      await get().commitItineraryChange({
        ...state.itinerary,
        days: newDays,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Failed to set day transport mode:", err);
      set({ saveError: true });
      throw err;
    } finally {
      set({ isSaving: false });
    }
  },

  setAllDaysTransportMode: async (mode) => {
    const state = get();
    if (!state.itinerary) return;
    set({ isSaving: true, saveError: false });
    try {
      const newDays = state.itinerary.days.map((d) => ({ ...d, transport_mode: mode }));
      await get().commitItineraryChange({
        ...state.itinerary,
        days: newDays,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Failed to set all days transport mode:", err);
      set({ saveError: true });
      throw err;
    } finally {
      set({ isSaving: false });
    }
  },

  // Generation Actions
  startGeneration: async (itineraryId, locale, onComplete) => {
    const state = get();
    if (state.isGenerating) return; // guard against double-invoke (StrictMode)

    try {
      const status = state.itinerary?.status;
      if (status === "generating") {
        // Resumed mid-generation (user refreshed / navigated back) → poll DB.
        await startPollingInternal(itineraryId, set);
      } else {
        // Fresh draft / retry after failure → open SSE stream.
        await startStreamingInternal(itineraryId, locale, get, set);
      }
    } finally {
      // Always call onComplete, regardless of success or failure
      onComplete?.();
    }
  },

  stopGeneration: () => {
    // Abort any in-flight SSE stream.
    const { generationAbortController } = get();
    generationAbortController?.abort();

    // Clear polling timer.
    if (pollingIntervalHandle) {
      clearInterval(pollingIntervalHandle);
      pollingIntervalHandle = null;
    }

    set({ isGenerating: false, generationAbortController: null });
  },

  // Drag & Drop Logic
  handleDragOver: (active, over, activeData, overData) => {
    const state = get();
    if (!state.previewItinerary) return;

    if (!over) {
      set({ crossDayDragInfo: null });
      return;
    }

    if (active.id === over.id) {
      // Item hovering over itself (common after cross-day insertion).
      // Preserve crossDayDragInfo so disableAnimation stays active on the
      // target day. Clearing it here would re-enable transitions and cause
      // dnd-kit's sortable strategy transforms to animate as a visible "swap".
      return;
    }

    const result = calculateDragOverUpdate(
      active,
      over,
      activeData,
      overData,
      state.previewItinerary,
    );

    if (result) {
      get().updatePreview(result.newItinerary);
      set({ crossDayDragInfo: result.crossDayInfo });
    }
  },
}));

function cloneItinerarySnapshot(itinerary: Itinerary): Itinerary {
  return structuredClone(itinerary);
}

function serializeItinerary(itinerary: Itinerary): string {
  return JSON.stringify(itinerary);
}

type StoreGet = () => ItineraryState;
type StoreSet = (
  partial: Partial<ItineraryState> | ((state: ItineraryState) => Partial<ItineraryState>),
) => void;

async function startStreamingInternal(
  itineraryId: string,
  locale: string,
  get: StoreGet,
  set: StoreSet,
): Promise<void> {
  // Concurrency guard
  const existingController = get().generationAbortController;
  existingController?.abort();

  const controller = new AbortController();
  set({ isGenerating: true, generationAbortController: controller });

  let streamCompleted = false;

  try {
    await aiClient.streamItinerary(
      itineraryId,
      locale,
      (data) => appendStreamedActivityInternal(data.day_number, data.activity, set),
      () => {
        streamCompleted = true;
      },
      () => {
        set({
          isGenerating: false,
          errorKind: "runtime",
          errorCode: "GENERATION_FAILED",
          generationAbortController: null,
        });
      },
      controller.signal,
    );

    if (streamCompleted) {
      try {
        const finalItinerary = await loadItinerary(itineraryId);
        set({ itinerary: finalItinerary, isGenerating: false, generationAbortController: null });
      } catch (reloadErr) {
        console.error("Post-generation reconcile failed:", reloadErr);
        set({ isGenerating: false, generationAbortController: null });
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;

    if (err instanceof ApiError) {
      if (err.code === "ALREADY_GENERATING") {
        set({ generationAbortController: null });
        return startPollingInternal(itineraryId, set);
      }

      if (err.code === "INSUFFICIENT_CREDITS") {
        set({
          isGenerating: false,
          errorKind: "runtime",
          errorCode: "INSUFFICIENT_CREDITS",
          generationAbortController: null,
        });
        return;
      }
    }

    console.error("Stream failed:", err);
    set({
      isGenerating: false,
      errorKind: "runtime",
      errorCode: "GENERATION_FAILED",
      generationAbortController: null,
    });
  }
}

async function startPollingInternal(itineraryId: string, set: StoreSet): Promise<void> {
  if (pollingIntervalHandle) clearInterval(pollingIntervalHandle);

  set({ isGenerating: true });

  return new Promise((resolve) => {
    let attempts = 0;
    // ~1 minute at 3s interval
    const MAX_ATTEMPTS = 20;
    const ATTEMPT_INTERVAL = 3000;

    pollingIntervalHandle = setInterval(async () => {
      attempts++;

      if (attempts > MAX_ATTEMPTS) {
        if (pollingIntervalHandle) {
          clearInterval(pollingIntervalHandle);
          pollingIntervalHandle = null;
        }
        set({
          isGenerating: false,
          errorKind: "runtime",
          errorCode: "GENERATION_TIMEOUT",
        });
        resolve(); // Resolve on timeout
        return;
      }

      try {
        const data = await loadItinerary(itineraryId);
        if (data.status === "completed") {
          if (pollingIntervalHandle) {
            clearInterval(pollingIntervalHandle);
            pollingIntervalHandle = null;
          }
          set({ itinerary: data, isGenerating: false });
          resolve(); // Resolve on success
        } else if (data.status === "failed") {
          if (pollingIntervalHandle) {
            clearInterval(pollingIntervalHandle);
            pollingIntervalHandle = null;
          }
          set({
            isGenerating: false,
            errorKind: "runtime",
            errorCode: "GENERATION_FAILED",
          });
          resolve(); // Resolve on failure
        }
        // status === "generating" → keep polling.
      } catch {
        // Transient errors: keep polling (the next tick will retry).
      }
    }, ATTEMPT_INTERVAL);
  });
}

function appendStreamedActivityInternal(
  dayNumber: number,
  activity: Activity,
  set: StoreSet,
): void {
  set((state) => {
    if (!state.itinerary) return state;

    const days = [...state.itinerary.days];
    const existingDayIdx = days.findIndex((d) => d.day_number === dayNumber);

    if (existingDayIdx !== -1) {
      const updatedActivities = [...days[existingDayIdx].activities, activity];
      updatedActivities.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      days[existingDayIdx] = {
        ...days[existingDayIdx],
        activities: updatedActivities,
      };
    } else {
      days.push({ day_number: dayNumber, activities: [activity] });
      days.sort((a, b) => a.day_number - b.day_number);
    }

    return {
      itinerary: {
        ...state.itinerary,
        days,
        updated_at: new Date().toISOString(),
      },
    };
  });
}
