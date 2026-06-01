/**
 * Credit costs for user actions.
 * Single source of truth — imported by both frontend (Next.js) and backend (Deno edge functions).
 * Keep this file free of any runtime-specific imports.
 */
export const CREDIT_COSTS = {
  GENERATE_ITINERARY: 100,
  CHAT: 10,
  OPTIMIZE_ROUTE: 2,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;
