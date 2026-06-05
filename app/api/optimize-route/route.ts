import { NextRequest } from "next/server";
import { z } from "zod";
import { validateEdgeProxyRequest } from "@/lib/api/edge-proxy";

// The optimizer reads all activity/day data from the stored itinerary (DB is
// the source of truth), so the request only names which day to optimize. Exactly
// one day per request — OPTIMIZE_ROUTE is charged once.
const OptimizeRouteSchema = z.object({
  itineraryId: z.uuid(),
  dayNumbers: z.array(z.number().int().positive()).length(1),
});

export async function POST(request: NextRequest) {
  const validated = await validateEdgeProxyRequest(request, OptimizeRouteSchema);
  if (validated instanceof Response) {
    return validated;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const response = await fetch(`${supabaseUrl}/functions/v1/optimize-route`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: validated.authHeader,
    },
    body: JSON.stringify(validated.data),
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-cache",
    },
  });
}
