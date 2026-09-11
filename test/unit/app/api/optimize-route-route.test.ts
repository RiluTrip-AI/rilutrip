import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/optimize-route/route";

const validBody = {
  itineraryId: "11111111-1111-4111-8111-111111111111",
  dayNumbers: [1],
};

function makeRequest(body: unknown, headers: Record<string, string>) {
  return new Request("http://localhost/api/optimize-route", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.local";
});

describe("POST /api/optimize-route", () => {
  it("returns 401 without an Authorization header", async () => {
    const res = await POST(makeRequest(validBody, {}) as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid body", async () => {
    const res = await POST(
      makeRequest(
        { itineraryId: "not-a-uuid", dayNumbers: [] },
        { authorization: "Bearer t" },
      ) as never,
    );
    expect(res.status).toBe(400);
  });

  it("rejects more than one day per request", async () => {
    const res = await POST(
      makeRequest(
        { itineraryId: "11111111-1111-4111-8111-111111111111", dayNumbers: [1, 2] },
        { authorization: "Bearer t" },
      ) as never,
    );
    expect(res.status).toBe(400);
  });

  it("proxies a valid request to the edge function with the auth header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ days: [], warnings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await POST(makeRequest(validBody, { authorization: "Bearer tkn" }) as never);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://supabase.local/functions/v1/optimize-route",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tkn" }),
      }),
    );
  });
});
