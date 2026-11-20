import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import { getRateLimiter, type RateLimitRule } from "@/lib/api/rate-limit";
import { CLIENT_FORM_EVENT_MAX_BYTES, parseClientFormEvent } from "@/lib/analytics/client-form-events";
import { authorizeRequest } from "@/lib/auth/server";

/**
 * ============================================================================
 * POST /api/telemetry/client-form — THE CARD'S CREATE EVENTS, INTO THE SERVER LOG (QA, f073, 20 Nov 2026)
 * ============================================================================
 *
 * Signed-in callers only, a per-user rate limit, a 1 KB body, and an allow-listed shape (`client-form-events.ts`):
 * no free text, no names, no form content. Each accepted event is one `[client.form]` log line and nothing else: no
 * table, no reply body. The line carries the server's own deployment id beside the page's, so a press from a page
 * built for an older deploy reads as one. Who sent it is not logged.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per signed-in user. A create is a handful of events; sixty a minute is a page stuck in a loop. */
export const CLIENT_FORM_RATE_LIMIT: RateLimitRule = { limit: 60, windowSeconds: 60 };

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "ask_questions");
    const decision = getRateLimiter().check(`clientFormTelemetry:${context.identity.subject}`, CLIENT_FORM_RATE_LIMIT);
    if (!decision.allowed) {
      return NextResponse.json({ error: "Too many events." }, { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } });
    }
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > CLIENT_FORM_EVENT_MAX_BYTES) return NextResponse.json({ error: "Too large." }, { status: 413 });
    const text = await request.text();
    if (text.length > CLIENT_FORM_EVENT_MAX_BYTES) return NextResponse.json({ error: "Too large." }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Not an event." }, { status: 400 });
    }
    const event = parseClientFormEvent(body);
    if (!event) return NextResponse.json({ error: "Not an event." }, { status: 400 });
    console.info(`[client.form] ${JSON.stringify({ ...event, serverDeploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null })}`);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, "telemetry/client-form");
  }
}
