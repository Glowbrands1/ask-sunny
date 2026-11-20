import type { ClientFormEvent } from "@/lib/analytics/client-form-events";

/**
 * The deployment this page's code was built for (f073): `next.config.ts` inlines Vercel's VERCEL_DEPLOYMENT_ID at
 * build time. Null outside Vercel.
 */
export function buildDeploymentId(): string | null {
  return process.env.NEXT_PUBLIC_BUILD_DEPLOYMENT_ID || null;
}

/**
 * Sends one create event to the server log (`POST /api/telemetry/client-form`). Fire and forget: it never throws,
 * never waits, and never changes what the card does; `keepalive` lets it leave even as the page unloads.
 */
export function sendClientFormEvent(event: Omit<ClientFormEvent, "deploymentId">): void {
  try {
    if (typeof fetch !== "function") return;
    void fetch("/api/telemetry/client-form", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...event, deploymentId: buildDeploymentId() }),
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    // Telemetry never breaks the card.
  }
}
