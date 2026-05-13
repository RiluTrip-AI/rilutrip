import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { emitOperationalAlert } from "./alerts.ts";

export interface RateLimitConfig {
  endpoint: string;
  windowSeconds: number;
  maxCount: number;
  banSeconds: number;
}

export const RATE_LIMITS = {
  OPTIMIZE_ROUTE: {
    endpoint: "optimize-route",
    windowSeconds: 60,
    maxCount: 10,
    banSeconds: 300,
  },
} as const satisfies Record<string, RateLimitConfig>;

export async function checkRateLimit(
  supabaseAdmin: SupabaseClient,
  userId: string,
  config: RateLimitConfig,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("increment_and_check_rate_limit", {
    p_user_id: userId,
    p_endpoint: config.endpoint,
    p_window_seconds: config.windowSeconds,
    p_max_count: config.maxCount,
    p_ban_seconds: config.banSeconds,
  });

  if (error) {
    await emitOperationalAlert({
      endpoint: config.endpoint,
      error: error.message,
      event: "rate_limit_error",
      message: "Rate-limit RPC failed; request is allowed to preserve endpoint availability.",
      metadata: {
        ban_seconds: config.banSeconds,
        fail_open: true,
        max_count: config.maxCount,
        window_seconds: config.windowSeconds,
      },
      phase: "check_failed",
      severity: "critical",
      userId,
    });
    return true;
  }

  return data === true;
}
