type AlertSeverity = "warning" | "critical";

interface OperationalAlertInput {
  event: string;
  severity: AlertSeverity;
  message: string;
  endpoint?: string;
  phase?: string;
  userId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

const ALERT_WEBHOOK_TIMEOUT_MS = 1500;

export async function emitOperationalAlert(input: OperationalAlertInput): Promise<void> {
  const payload = {
    ...input,
    alert: true,
    service: "supabase-edge",
    timestamp: new Date().toISOString(),
  };

  console.error(JSON.stringify(payload));

  const webhookUrl = Deno.env.get("OPERATIONAL_ALERT_WEBHOOK_URL");
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ALERT_WEBHOOK_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        alert: true,
        event: "operational_alert_delivery_failed",
        error: err instanceof Error ? err.message : String(err),
        original_event: input.event,
        service: "supabase-edge",
        severity: "warning",
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
