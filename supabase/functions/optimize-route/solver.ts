// TSP solvers for the optimize-route edge function: ORS Vroom (primary, with
// time windows) and a time-window-aware greedy fallback.

import {
  type ActivityInput,
  type ActivityUnassignedWarning,
  type OptimizeResult,
  type TransportMode,
  isRecord,
} from "./types.ts";
import {
  MEAL_WINDOWS,
  formatTime,
  getWindowCloseMinutes,
  getWindowOpenMinutes,
  parseTimeToSeconds,
} from "./time-windows.ts";

const ORS_URL = "https://api.openrouteservice.org/optimization";

export function greedyFallback(
  activities: ActivityInput[],
  matrix: number[][],
  startTimeMinutes: number,
): OptimizeResult {
  const n = activities.length;
  const hasWindows = activities.some((a) => a.opening_hours || (a.type && MEAL_WINDOWS[a.type]));

  let start = 0;
  if (hasWindows) {
    let earliest = Infinity;
    activities.forEach((a, i) => {
      const open = getWindowOpenMinutes(a) ?? 9999;
      if (open < earliest) {
        earliest = open;
        start = i;
      }
    });
  }

  const unvisited = new Set(Array.from({ length: n }, (_, i) => i));
  let current = start;
  unvisited.delete(start);
  const route = [start];
  let currentTime = startTimeMinutes;

  while (unvisited.size > 0) {
    let nextNode = -1;
    if (hasWindows) {
      let bestScore: [number, number] = [3, Infinity];
      for (const j of unvisited) {
        const travel = matrix[current][j];
        const arrive = currentTime + activities[current].duration_minutes + travel;
        const open = getWindowOpenMinutes(activities[j]);
        const close = getWindowCloseMinutes(activities[j]);
        let score: [number, number];

        if (close !== null && arrive > close) {
          score = [2, travel];
        } else if (open !== null) {
          score = [0, Math.max(0, open - arrive) + travel];
        } else {
          score = [1, travel];
        }

        if (score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
          bestScore = score;
          nextNode = j;
        }
      }
      const travel = matrix[current][nextNode];
      const arrive = currentTime + activities[current].duration_minutes + travel;
      const open = getWindowOpenMinutes(activities[nextNode]);
      currentTime = Math.max(arrive, open ?? arrive);
    } else {
      let minTravel = Infinity;
      for (const j of unvisited) {
        if (matrix[current][j] < minTravel) {
          minTravel = matrix[current][j];
          nextNode = j;
        }
      }
      currentTime += activities[current].duration_minutes + matrix[current][nextNode];
    }
    route.push(nextNode);
    unvisited.delete(nextNode);
    current = nextNode;
  }

  const order = route.map((i) => activities[i].id);
  const travelTimes = route.slice(0, -1).map((from, k) => Math.max(1, matrix[from][route[k + 1]]));
  const startTimes: string[] = [];
  let t = startTimeMinutes;
  for (let k = 0; k < route.length; k++) {
    const act = activities[route[k]];
    const open = getWindowOpenMinutes(act);
    t = Math.max(t, open ?? t);
    startTimes.push(formatTime(t));
    t += act.duration_minutes + (k < travelTimes.length ? travelTimes[k] : 0);
  }

  return { order, travelTimesMinutes: travelTimes, startTimes, warnings: [] };
}

function buildUnassignedWarnings(
  activities: ActivityInput[],
  dayNumber: number,
  endTime: string,
  unassigned: unknown,
): ActivityUnassignedWarning[] {
  if (!Array.isArray(unassigned)) return [];

  const warnings: ActivityUnassignedWarning[] = [];
  for (const entry of unassigned) {
    if (!isRecord(entry) || typeof entry.id !== "number") continue;
    const activity = activities[entry.id - 1];
    if (!activity) continue;
    const hasActivityWindow = activity.opening_hours !== undefined || Boolean(activity.type);
    warnings.push({
      code: "ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS",
      dayNumber,
      activityId: activity.id,
      title: activity.title,
      durationMinutes: activity.duration_minutes,
      reason: hasActivityWindow ? "ROUTE_CONSTRAINTS" : "DAY_END",
      dayEndTime: endTime,
    });
  }
  return warnings;
}

export async function callVroom(
  activities: ActivityInput[],
  minuteMatrix: number[][],
  _mode: TransportMode,
  startTime: string,
  endTime: string,
  timeWindows: Array<[number, number] | null>,
  dayNumber: number,
): Promise<OptimizeResult | null> {
  const apiKey = Deno.env.get("ORS_API_KEY");
  if (!apiKey) return null;

  const secondsMatrix = minuteMatrix.map((row) => row.map((v) => v * 60));
  const jobs = activities.map((act, i) => {
    const job: Record<string, unknown> = {
      id: i + 1,
      location_index: i,
      service: act.duration_minutes * 60,
    };
    const timeWindow = timeWindows[i];
    if (timeWindow) job.time_windows = [timeWindow];
    return job;
  });

  try {
    const res = await fetch(ORS_URL, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        jobs,
        vehicles: [
          {
            id: 1,
            profile: "driving-car",
            start_index: 0,
            time_window: [parseTimeToSeconds(startTime), parseTimeToSeconds(endTime)],
          },
        ],
        matrices: { "driving-car": { durations: secondsMatrix } },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const routes = data.routes ?? [];
    if (!routes.length) return null;

    type VroomStep = {
      id: number;
      arrival: number;
      service: number;
      waiting_time: number;
      type: string;
    };
    const steps: VroomStep[] = routes[0].steps.filter((s: VroomStep) => s.type === "job");
    const unassignedWarnings = buildUnassignedWarnings(
      activities,
      dayNumber,
      endTime,
      data.unassigned,
    );
    if (steps.length === 0 && unassignedWarnings.length === 0) return null;

    const order = steps.map((s) => activities[s.id - 1].id);
    const travelTimes = steps.slice(0, -1).map((s, k) => {
      const travelSec = steps[k + 1].arrival - s.arrival - s.waiting_time - s.service;
      return Math.max(1, Math.round(travelSec / 60));
    });
    const startTimes = steps.map((s) => formatTime(Math.round((s.arrival + s.waiting_time) / 60)));
    return { order, travelTimesMinutes: travelTimes, startTimes, warnings: unassignedWarnings };
  } catch {
    return null;
  }
}
