import { getAIClient, VERTEX_CONFIG } from "../_shared/vertex-ai.ts";
import { JSONParser } from "npm:@streamparser/json";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyUser } from "../_shared/auth.ts";
import { parseJsonRequest, unauthorizedResponse } from "../_shared/request-guards.ts";
import { captureCredits, refundCredits } from "../_shared/credits.ts";
import { createSupabaseAdminClient, createSupabaseClient } from "../_shared/supabase.ts";

import { z } from "npm:zod";
import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolvePlacesInfo } from "../_shared/place-resolver.ts";

const GenerateRequestSchema = z.object({
  itinerary_id: z.string().min(1, "Itinerary ID is required"),
  locale: z.string().optional(),
});

type GenerateItineraryRequest = z.infer<typeof GenerateRequestSchema>;

type GeneratedActivity = {
  id: string;
  time: string;
  order: number;
  title: string;
  note?: string;
  description?: string;
  location: {
    name: string;
    lat?: number;
    lng?: number;
    place_id?: string;
    opening_hours?: unknown;
    [key: string]: unknown;
  };
  duration_minutes: number;
  type?: "lunch" | "dinner" | "breakfast" | "transit";
  opening_hours?: { open: string; close: string };
  [key: string]: unknown;
};

type GeneratedDay = {
  day_number: number;
  activities: GeneratedActivity[];
  start_time: string;
  end_time: string;
  transport_mode: string;
  optimization_warnings?: OptimizeWarning[];
};

type OptimizeWarning =
  | {
      code: "ACTIVITY_WINDOW_TOO_SHORT";
      dayNumber: number;
      activityId: string;
      title: string;
      openingHours: { open: string; close: string };
      durationMinutes: number;
      availableMinutes: number;
    }
  | {
      code: "ACTIVITY_UNASSIGNED_BY_ROUTE_CONSTRAINTS";
      dayNumber: number;
      activityId: string;
      title: string;
      durationMinutes: number;
      reason?: "DAY_END" | "ROUTE_CONSTRAINTS";
      dayEndTime?: string;
    };

type OptimizedDayResult = {
  dayNumber: number;
  activities: Array<{ id: string; time: string; order: number }>;
  warnings?: OptimizeWarning[];
};

const TripSettingsSchema = z.object({
  startTime: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/),
  endTime: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/),
  transportMode: z.enum(["walking", "bicycling", "driving", "transit"]),
});

import { buildItineraryPrompt } from "./prompt.ts";

function calculateDayDate(startDate: string, dayNumber: number): string {
  const date = new Date(`${startDate}T00:00:00`);
  date.setDate(date.getDate() + dayNumber - 1);
  return date.toISOString().split("T")[0];
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function mergeOptimizedDays(days: GeneratedDay[], optimizedDays: OptimizedDayResult[]) {
  return days.map((day) => {
    const optimized = optimizedDays.find((candidate) => candidate.dayNumber === day.day_number);
    if (!optimized) return day;

    const updates = new Map(optimized.activities.map((activity) => [activity.id, activity]));
    return {
      ...day,
      optimization_warnings: optimized.warnings ?? [],
      activities: day.activities
        .map((activity) => {
          const update = updates.get(activity.id);
          return update ? { ...activity, time: update.time, order: update.order } : activity;
        })
        .sort((a, b) => a.order - b.order),
    };
  });
}

async function optimizeGeneratedItinerary(input: {
  itineraryId: string;
  startDate: string;
  days: GeneratedDay[];
  authHeader: string;
  skipCreditCaptureToken: string;
}): Promise<GeneratedDay[]> {
  const gatewaySecret = Deno.env.get("API_GATEWAY_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!gatewaySecret || !supabaseUrl) return input.days;

  const optimizableDays = input.days.filter((day) => day.activities.length >= 2);
  if (optimizableDays.length === 0) return input.days;

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/optimize-route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: input.authHeader,
        "x-gateway-secret": gatewaySecret,
      },
      body: JSON.stringify({
        itineraryId: input.itineraryId,
        skipCreditCapture: true,
        skipCreditCaptureToken: input.skipCreditCaptureToken,
        days: optimizableDays.map((day) => ({
          dayNumber: day.day_number,
          date: calculateDayDate(input.startDate, day.day_number),
          transportMode: day.transport_mode,
          startTime: day.start_time,
          endTime: day.end_time,
          activities: day.activities.map((activity) => ({
            id: activity.id,
            title: activity.title,
            location: activity.location,
            duration_minutes: activity.duration_minutes,
            time: activity.time,
            ...(activity.type !== undefined && { type: activity.type }),
            ...(activity.opening_hours !== undefined && { opening_hours: activity.opening_hours }),
          })),
        })),
      }),
    });

    if (!response.ok) {
      console.error("Auto route optimization failed:", response.status, await response.text());
      return input.days;
    }

    const data = (await response.json()) as { days?: OptimizedDayResult[] };
    return Array.isArray(data.days) ? mergeOptimizedDays(input.days, data.days) : input.days;
  } catch (err) {
    console.error("Auto route optimization failed:", err);
    return input.days;
  }
}

async function finalizeGeneratedItinerary(
  supabaseAdmin: SupabaseClient,
  itineraryId: string,
  days: GeneratedDay[],
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("itineraries")
    .update({
      status: "completed",
      data: { days },
    })
    .eq("id", itineraryId);

  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let captured = false;
  let operationId: string | null = null;
  let userId: string | null = null;
  let itineraryId: string | null = null;

  try {
    const user = await verifyUser(req);
    if (!user) {
      return unauthorizedResponse();
    }
    userId = user.userId;

    const parsed = await parseJsonRequest(req, GenerateRequestSchema);
    if (parsed instanceof Response) {
      return parsed;
    }

    const { itinerary_id, locale }: GenerateItineraryRequest = parsed.data;
    itineraryId = itinerary_id;

    const ai = getAIClient();

    const supabaseAdmin = createSupabaseAdminClient();
    const supabaseClient = createSupabaseClient(req.headers.get("Authorization")!);

    // Fetch itinerary from DB — relying on RLS to enforce user ownership
    const { data: itineraryRow, error: fetchError } = await supabaseClient
      .from("itineraries")
      .select("id, user_id, destination, start_date, end_date, preferences, status, settings")
      .eq("id", itinerary_id)
      .single();

    if (fetchError || !itineraryRow) {
      return new Response(
        JSON.stringify({
          error: "Itinerary not found or forbidden",
          code: "NOT_FOUND",
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const {
      destination,
      start_date: startDate,
      end_date: endDate,
      preferences,
      settings: rawSettings,
    } = itineraryRow;
    const settings = TripSettingsSchema.parse(rawSettings);

    operationId = crypto.randomUUID();

    const { data: updateResult, error: updateError } = await supabaseAdmin
      .from("itineraries")
      .update({ status: "generating" })
      .eq("id", itinerary_id)
      .in("status", ["draft", "failed"])
      .select("id")
      .single();

    if (updateError || !updateResult) {
      // PGRST116 = no rows matched the WHERE clause → status is not draft/failed (conflict).
      if (updateError?.code === "PGRST116") {
        return new Response(
          JSON.stringify({
            error: "Cannot start generation: itinerary is not in a startable state",
            code: "ALREADY_GENERATING",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Any other error code = real DB failure.
      console.error("Failed to acquire generating lock:", updateError);
      return new Response(
        JSON.stringify({
          error: "Failed to start generation",
          code: "UPDATE_FAILED",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // deduct credits.
    const capture = await captureCredits(supabaseAdmin, user.userId, "GENERATE_ITINERARY");
    if (!capture.success) {
      // Roll back the status lock so the user can retry.
      await supabaseAdmin.from("itineraries").update({ status: "draft" }).eq("id", itinerary_id);

      if (capture.error) {
        // Backend/RPC error - return 500
        console.error(
          JSON.stringify({
            action: "GENERATE_ITINERARY",
            error: capture.error,
            event: "credit_event",
            operation_id: operationId,
            phase: "capture_failed",
            user_id: user.userId,
          }),
        );
        return new Response(
          JSON.stringify({
            error: "Credit system error. Please try again later.",
            code: "CREDIT_SYSTEM_ERROR",
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      // Insufficient credits - return 402
      return new Response(
        JSON.stringify({
          error: "Insufficient credits",
          code: "INSUFFICIENT_CREDITS",
        }),
        {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    captured = true;

    const prompt = buildItineraryPrompt(
      destination,
      startDate,
      endDate,
      preferences ?? undefined,
      locale,
    );

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let clientDisconnected = false;

        function emitSSE(eventType: string, data: object) {
          if (clientDisconnected) return;
          try {
            const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(message));
          } catch {
            console.log("Client disconnected, background generation continuing...");
            clientDisconnected = true;
          }
        }

        // Track days and activities for DB save
        const dayMap = new Map<
          number,
          {
            day_number: number;
            activities: object[];
            start_time: string;
            end_time: string;
            transport_mode: string;
          }
        >();

        // Track async resolution tasks before saving
        const pendingResolutions: Promise<void>[] = [];

        // @streamparser/json: fire onValue for each complete activity object
        // paths: ["$.itinerary.*.activities.*"] means each activity in each day
        const parser = new JSONParser({
          paths: ["$.itinerary.*.activities.*"],
        });

        parser.onValue = ({ value, stack }: { value: unknown; stack: Array<{ key?: number }> }) => {
          const activity = value as {
            time: string;
            title: string;
            description: string;
            location: {
              name: string;
              lat?: number;
              lng?: number;
              place_id?: string;
              rating?: number;
              user_ratings_total?: number;
              website?: string;
              opening_hours?: Record<string, unknown>;
            };
            duration_minutes: number;
          };

          if (!activity.time || !activity.title) return;

          // Extract day_number from JSONPath stack
          // stack format: [root, "itinerary", dayIndex, "activities", activityIndex]
          // Each element is a StackElement { key, value, partial }
          const dayIndex = stack[2]?.key;
          if (typeof dayIndex !== "number") return;
          const day_number = dayIndex + 1; // Convert 0-based index to 1-based day number

          // Add UUID and order
          const activityWithId = {
            ...activity,
            id: crypto.randomUUID(),
            order: dayMap.get(day_number)?.activities.length ?? 0,
          };

          // Accumulate for DB save synchronously to maintain order.
          // Stamp settings into each new day so the final DB write is complete.
          if (!dayMap.has(day_number)) {
            dayMap.set(day_number, {
              day_number,
              activities: [],
              start_time: settings.startTime,
              end_time: settings.endTime,
              transport_mode: settings.transportMode,
            });
          }
          dayMap.get(day_number)!.activities.push(activityWithId);

          // Resolve place info asynchronously before emitting SSE
          const resolveTask = (async () => {
            try {
              const resolvedData = await resolvePlacesInfo([
                {
                  id: activityWithId.id,
                  name: activityWithId.location.name,
                },
              ]);

              if (resolvedData.length > 0) {
                const resolved = resolvedData[0];
                activityWithId.location = {
                  name: resolved.name || activityWithId.location.name,
                  ...(resolved.lat !== undefined && { lat: resolved.lat }),
                  ...(resolved.lng !== undefined && { lng: resolved.lng }),
                  ...(resolved.place_id !== undefined && {
                    place_id: resolved.place_id,
                  }),
                  ...(resolved.rating !== undefined && {
                    rating: resolved.rating,
                  }),
                  ...(resolved.user_ratings_total !== undefined && {
                    user_ratings_total: resolved.user_ratings_total,
                  }),
                  ...(resolved.website !== undefined && {
                    website: resolved.website,
                  }),
                  ...(resolved.opening_hours !== undefined && {
                    opening_hours: resolved.opening_hours,
                  }),
                };
              }
            } catch (err) {
              console.error("Place resolution failed for", activityWithId.location.name, err);
            }

            // Emit SSE only after (conditional) resolution completes
            emitSSE("activity", {
              day_number,
              activity: activityWithId,
            });
          })();

          pendingResolutions.push(resolveTask);
        };

        try {
          const result = await ai.models.generateContentStream({
            model: VERTEX_CONFIG.ITINERARY_MODEL,
            contents: prompt,
          });
          let accumulatedText = "";
          let jsonStarted = false;

          for await (const chunk of result) {
            const text = chunk.text;
            if (!text) continue;

            accumulatedText += text;

            if (!jsonStarted) {
              // Look for the start of JSON
              const jsonStartIndex = accumulatedText.indexOf("{");
              if (jsonStartIndex === -1) continue;

              // Found JSON, extract from start and mark as started
              jsonStarted = true;
              accumulatedText = accumulatedText.substring(jsonStartIndex);
            }

            // Remove markdown code fences (both ``` and ```json)
            const cleaned = accumulatedText.replace(/```(?:json)?/gi, "");

            // Only write the new content to parser
            if (cleaned) {
              parser.write(cleaned);
              accumulatedText = ""; // Clear buffer after writing
            }
          }

          // Wait for all inline resolution tasks to complete
          await Promise.all(pendingResolutions);

          // Convert map to sorted array
          let allDays = Array.from(dayMap.values()).sort((a, b) => a.day_number - b.day_number);

          const skipCreditCaptureToken = crypto.randomUUID();
          const internalOptimizationTokenHash = await sha256Hex(skipCreditCaptureToken);

          // Save generated days and the temporary internal optimization token,
          // but keep status as generating until auto optimization finishes.
          const { error: updateError } = await supabaseAdmin
            .from("itineraries")
            .update({
              data: {
                days: allDays,
                internal_optimization_token_hash: internalOptimizationTokenHash,
              },
            })
            .eq("id", itinerary_id);

          if (updateError) {
            console.error("Failed to save itinerary to DB:", updateError);
            throw updateError;
          }

          try {
            allDays = await optimizeGeneratedItinerary({
              itineraryId: itinerary_id,
              startDate,
              days: allDays as GeneratedDay[],
              authHeader: req.headers.get("Authorization")!,
              skipCreditCaptureToken,
            });
          } finally {
            try {
              await finalizeGeneratedItinerary(
                supabaseAdmin,
                itinerary_id,
                allDays as GeneratedDay[],
              );
            } catch (finalizeError) {
              console.error("Failed to finalize generated itinerary:", finalizeError);
              throw finalizeError;
            }
          }
          captured = false;

          emitSSE("complete", {});
          if (!clientDisconnected) {
            try {
              controller.close();
            } catch {}
          }
        } catch (error) {
          console.error("Streaming error:", error);

          await supabaseAdmin
            .from("itineraries")
            .update({ status: "failed" })
            .eq("id", itinerary_id);

          if (captured) {
            const refund = await refundCredits(supabaseAdmin, user.userId, "GENERATE_ITINERARY");
            if (refund.success) {
              captured = false;
            } else {
              console.error(
                JSON.stringify({
                  action: "GENERATE_ITINERARY",
                  error: refund.error ?? "refund failed",
                  event: "credit_event",
                  operation_id: operationId,
                  phase: "refund_failed",
                  user_id: user.userId,
                }),
              );
            }
          }

          emitSSE("error", { message: "Internal server error" });
          if (!clientDisconnected) {
            try {
              controller.close();
            } catch {}
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Handler error:", error);

    if (captured && userId) {
      const supabaseAdmin = createSupabaseAdminClient();
      if (itineraryId) {
        await supabaseAdmin.from("itineraries").update({ status: "failed" }).eq("id", itineraryId);
      }
      const refund = await refundCredits(supabaseAdmin, userId, "GENERATE_ITINERARY");
      if (refund.success) {
        captured = false;
      } else {
        console.error(
          JSON.stringify({
            action: "GENERATE_ITINERARY",
            error: refund.error ?? "refund failed",
            event: "credit_event",
            operation_id: operationId,
            phase: "refund_failed",
            user_id: userId,
          }),
        );
      }
    }

    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
