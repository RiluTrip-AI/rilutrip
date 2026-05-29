import { getAIClient, VERTEX_CONFIG } from "../_shared/vertex-ai.ts";
import { JSONParser } from "npm:@streamparser/json";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyUser } from "../_shared/auth.ts";
import { parseJsonRequest, unauthorizedResponse } from "../_shared/request-guards.ts";
import { captureCredits, refundCredits } from "../_shared/credits.ts";
import { createSupabaseAdminClient, createSupabaseClient } from "../_shared/supabase.ts";

import { z } from "npm:zod";
import { resolvePlacesInfo } from "../_shared/place-resolver.ts";

const GenerateRequestSchema = z.object({
  itinerary_id: z.string().min(1, "Itinerary ID is required"),
  locale: z.string().optional(),
});

type GenerateItineraryRequest = z.infer<typeof GenerateRequestSchema>;

import { buildItineraryPrompt } from "./prompt.ts";

const VALID_TRANSPORT_MODES = ["driving", "walking", "transit", "bicycling"];
const TIME_FORMAT = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

interface RawDayMeta {
  start_time?: unknown;
  end_time?: unknown;
  transport_mode?: unknown;
}

/**
 * Validate AI-provided day-level metadata at the trust boundary.
 *
 * Keeps only well-formed values and drops anything invalid — it never
 * fabricates defaults. A missing/invalid field stays absent so the rest of
 * the system can treat `undefined` as "not set" and resolve a default at the
 * point of use (e.g. route optimization) rather than baking a guess into the DB.
 */
function sanitizeDayMeta(meta: RawDayMeta): {
  start_time?: string;
  end_time?: string;
  transport_mode?: string;
} {
  const start =
    typeof meta.start_time === "string" && TIME_FORMAT.test(meta.start_time)
      ? meta.start_time
      : undefined;
  const end =
    typeof meta.end_time === "string" && TIME_FORMAT.test(meta.end_time)
      ? meta.end_time
      : undefined;
  const transport_mode =
    typeof meta.transport_mode === "string" && VALID_TRANSPORT_MODES.includes(meta.transport_mode)
      ? meta.transport_mode
      : undefined;

  return {
    // Times only make sense as a pair with start before end; drop both otherwise.
    ...(start && end && start < end ? { start_time: start, end_time: end } : {}),
    ...(transport_mode ? { transport_mode } : {}),
  };
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
      .select("id, user_id, destination, start_date, end_date, description, status")
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

    const { destination, start_date: startDate, end_date: endDate, description } = itineraryRow;

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
      description ?? undefined,
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
            start_time?: unknown;
            end_time?: unknown;
            transport_mode?: unknown;
          }
        >();

        function ensureDay(day_number: number) {
          if (!dayMap.has(day_number)) {
            dayMap.set(day_number, { day_number, activities: [] });
          }
          return dayMap.get(day_number)!;
        }

        // Track async resolution tasks before saving
        const pendingResolutions: Promise<void>[] = [];

        // @streamparser/json: fire onValue for each complete activity object as
        // well as the day-level scalar fields. `$.itinerary.*.activities.*`
        // matches each activity; the scalar paths match each day's metadata.
        const parser = new JSONParser({
          paths: [
            "$.itinerary.*.activities.*",
            "$.itinerary.*.start_time",
            "$.itinerary.*.end_time",
            "$.itinerary.*.transport_mode",
          ],
        });

        parser.onValue = ({
          value,
          key,
          stack,
        }: {
          value?: unknown;
          key?: string | number;
          stack: Array<{ key?: string | number }>;
        }) => {
          const dayIndex = stack[2]?.key;
          if (typeof dayIndex !== "number") return;
          const day_number = dayIndex + 1; // Convert 0-based index to 1-based day number

          // Day-level scalar fields live directly on the day object.
          if (key === "start_time" || key === "end_time" || key === "transport_mode") {
            ensureDay(day_number)[key] = value;
            return;
          }

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

          // Add UUID and order
          const activityWithId = {
            ...activity,
            id: crypto.randomUUID(),
            order: dayMap.get(day_number)?.activities.length ?? 0,
          };

          // Accumulate for DB save synchronously to maintain order
          ensureDay(day_number).activities.push(activityWithId);

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
          const allDays = Array.from(dayMap.values())
            .sort((a, b) => a.day_number - b.day_number)
            .map(({ day_number, activities, start_time, end_time, transport_mode }) => ({
              day_number,
              activities,
              // Validate AI-provided metadata; invalid/missing values are dropped, not defaulted.
              ...sanitizeDayMeta({ start_time, end_time, transport_mode }),
            }));

          // Save complete itinerary to DB
          const { error: updateError } = await supabaseAdmin
            .from("itineraries")
            .update({
              status: "completed",
              data: { days: allDays },
            })
            .eq("id", itinerary_id);

          if (updateError) {
            console.error("Failed to save itinerary to DB:", updateError);
            throw updateError;
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
