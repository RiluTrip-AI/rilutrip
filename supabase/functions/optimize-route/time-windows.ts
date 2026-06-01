// Time helpers and activity time-window logic (meal windows + opening hours)
// for the optimize-route edge function.

import { type ActivityInput, type OptimizeWarning, isRecord } from "./types.ts";

export const MEAL_WINDOWS: Record<string, { open: string; close: string }> = {
  breakfast: { open: "07:00", close: "10:00" },
  lunch: { open: "11:00", close: "14:00" },
  dinner: { open: "17:30", close: "21:00" },
};

export function parseTimeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function formatTime(mins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, mins));
  const h = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const m = (clamped % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function parseTimeToSeconds(hhmm: string): number {
  return parseTimeToMinutes(hhmm) * 60;
}

function secondsToHHMM(seconds: number): string {
  return formatTime(Math.floor(seconds / 60));
}

function resolveCloseSeconds(hhmm: string, openSec: number): number {
  const sec = parseTimeToSeconds(hhmm);
  return sec === 0 || sec < openSec ? 86400 : sec;
}

export function getWindowOpenMinutes(act: ActivityInput): number | null {
  const mealWindow = act.type ? MEAL_WINDOWS[act.type] : undefined;
  const mealOpen = mealWindow ? parseTimeToMinutes(mealWindow.open) : null;
  const placeOpen = act.opening_hours ? parseTimeToMinutes(act.opening_hours.open) : null;
  return mealOpen !== null && placeOpen !== null
    ? Math.max(mealOpen, placeOpen)
    : (mealOpen ?? placeOpen);
}

export function getWindowCloseMinutes(act: ActivityInput): number | null {
  const mealWindow = act.type ? MEAL_WINDOWS[act.type] : undefined;
  const mealClose = mealWindow ? parseTimeToMinutes(mealWindow.close) : null;
  if (!act.opening_hours) return mealClose;

  const placeOpen = parseTimeToMinutes(act.opening_hours.open);
  const rawPlaceClose = parseTimeToMinutes(act.opening_hours.close);
  const placeClose = rawPlaceClose === 0 || rawPlaceClose < placeOpen ? 24 * 60 : rawPlaceClose;
  return mealClose !== null ? Math.min(mealClose, placeClose) : placeClose;
}

export function buildTimeWindow(
  act: ActivityInput,
  dayNumber: number,
): { timeWindow: [number, number] | null; warning: OptimizeWarning | null } {
  let openSec: number | null = null;
  let closeSec: number | null = null;
  let openingHours: { open: string; close: string } | null = null;

  if (act.type && MEAL_WINDOWS[act.type]) {
    const window = MEAL_WINDOWS[act.type];
    openSec = parseTimeToSeconds(window.open);
    closeSec = parseTimeToSeconds(window.close);
    if (act.opening_hours) {
      openSec = Math.max(openSec, parseTimeToSeconds(act.opening_hours.open));
      closeSec = Math.min(closeSec, resolveCloseSeconds(act.opening_hours.close, openSec));
      if (openSec > closeSec) {
        openSec = parseTimeToSeconds(window.open);
        closeSec = parseTimeToSeconds(window.close);
      }
    }
    openingHours = { open: secondsToHHMM(openSec), close: secondsToHHMM(closeSec) };
  }

  if (!openingHours && act.opening_hours) {
    openSec = parseTimeToSeconds(act.opening_hours.open);
    closeSec = resolveCloseSeconds(act.opening_hours.close, openSec);
    openingHours = act.opening_hours;
  }

  if (openSec === null || closeSec === null || !openingHours) {
    return { timeWindow: null, warning: null };
  }

  const latestStartSec = closeSec - act.duration_minutes * 60;
  if (latestStartSec < openSec) {
    const availableMinutes = Math.max(0, Math.floor((closeSec - openSec) / 60));
    return {
      timeWindow: null,
      warning: {
        code: "ACTIVITY_WINDOW_TOO_SHORT",
        dayNumber,
        activityId: act.id,
        title: act.title,
        openingHours,
        durationMinutes: act.duration_minutes,
        availableMinutes,
      },
    };
  }

  return { timeWindow: [openSec, latestStartSec], warning: null };
}

export function buildActivityTimeConstraints(activities: ActivityInput[], dayNumber: number) {
  const constraints = activities.map((act) => buildTimeWindow(act, dayNumber));
  return {
    timeWindows: constraints.map((constraint) => constraint.timeWindow),
    warnings: constraints.flatMap((constraint) => (constraint.warning ? [constraint.warning] : [])),
  };
}

function getLocalWeekday(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getDay();
}

function toMinutes(
  point: { day?: number; hour?: number; minute?: number } | undefined,
): number | null {
  if (!point || typeof point.hour !== "number") return null;
  const minute = typeof point.minute === "number" ? point.minute : 0;
  if (point.hour < 0 || point.hour > 23 || minute < 0 || minute > 59) return null;
  return point.hour * 60 + minute;
}

function formatMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, minutes));
  if (clamped === 24 * 60) return "00:00";
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function normalizeOpeningHoursForDate(raw: unknown, date?: string) {
  if (isRecord(raw) && typeof raw.open === "string" && typeof raw.close === "string") {
    return { open: raw.open, close: raw.close };
  }
  if (!date || !isRecord(raw) || !Array.isArray(raw.periods)) return undefined;

  const weekday = getLocalWeekday(date);
  if (weekday === null) return undefined;
  const sameDayWindows: Array<{ open: number; close: number }> = [];
  const overnightWindows: Array<{ open: number; close: number }> = [];

  for (const rawPeriod of raw.periods) {
    if (!isRecord(rawPeriod)) continue;
    const open = isRecord(rawPeriod.open) ? rawPeriod.open : undefined;
    const close = isRecord(rawPeriod.close) ? rawPeriod.close : undefined;

    if (open?.day === weekday) {
      const openMinutes = toMinutes(open);
      const closeMinutes = toMinutes(close);
      if (openMinutes === null) continue;
      if (!close || close.day !== weekday || closeMinutes === null || closeMinutes <= openMinutes) {
        sameDayWindows.push({ open: openMinutes, close: 24 * 60 });
      } else {
        sameDayWindows.push({ open: openMinutes, close: closeMinutes });
      }
    }

    const previousWeekday = (weekday + 6) % 7;
    if (open?.day === previousWeekday && close?.day === weekday) {
      const closeMinutes = toMinutes(close);
      if (closeMinutes !== null && closeMinutes > 0) {
        overnightWindows.push({ open: 0, close: closeMinutes });
      }
    }
  }

  const windows = [...overnightWindows, ...sameDayWindows];
  if (windows.length === 0) return undefined;
  return {
    open: formatMinutes(Math.min(...windows.map((window) => window.open))),
    close: formatMinutes(Math.max(...windows.map((window) => window.close))),
  };
}
