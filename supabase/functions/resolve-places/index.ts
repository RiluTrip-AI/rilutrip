import { z } from "npm:zod";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyUser } from "../_shared/auth.ts";
import { resolvePlacesInfo } from "../_shared/place-resolver.ts";
import { parseJsonRequest, unauthorizedResponse } from "../_shared/request-guards.ts";

// ──────────────────────────────────────────────
// Request / Response schemas
// ──────────────────────────────────────────────

const PlaceInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  place_id: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

const MAX_RESOLVE_PLACES = 10;

const ResolveRequestSchema = z.object({
  places: z.array(PlaceInputSchema).min(1).max(MAX_RESOLVE_PLACES),
});

// ──────────────────────────────────────────────
// Edge Function handler
// ──────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // API Gateway Secret Check (Request from Next.JS api)
  const expectedSecret = Deno.env.get("API_GATEWAY_SECRET");
  const providedSecret = req.headers.get("x-gateway-secret");

  if (providedSecret !== expectedSecret) {
    console.warn("Blocked direct access attempt: Invalid Gateway Secret");
    return unauthorizedResponse();
  }

  try {
    // Auth
    const user = await verifyUser(req);
    if (!user) {
      return unauthorizedResponse();
    }

    const parsed = await parseJsonRequest(req, ResolveRequestSchema);
    if (parsed instanceof Response) {
      return parsed;
    }

    const { places } = parsed.data;

    // Resolve places sequentially to avoid Google API rate limits using the core logic
    const resolved = await resolvePlacesInfo(places);

    return new Response(JSON.stringify({ resolved }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Resolve places error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
