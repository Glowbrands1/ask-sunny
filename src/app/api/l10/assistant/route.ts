import { assistantRateLimit, readConfig, streamHubAssistant, validMessages } from "@/features/l10/assistant/assistant.server";
import { modelSpendGuard } from "@/lib/ai/spend-guard";
import { l10Viewer } from "@/features/l10/data.server";
import { isMeetingKey } from "@/features/l10/lib/config";
import { callHub } from "@/features/l10/partner/client.server";

export const dynamic = "force-dynamic";
// Deep think answers can take over a minute.
export const maxDuration = 300;

const json = (status: number, body: Record<string, unknown>, headers?: HeadersInit) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/**
 * The DM L10 tab's assistant (see features/l10/assistant/assistant.server.ts). Only a verified signed-in person who
 * may open the meeting here gets an answer; everyone else gets the same 404 as a missing page.
 */
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: "not_configured", message: "The assistant isn't configured for this deployment." });
  const viewer = await l10Viewer();
  if (!viewer) return json(404, { error: "not_found" });

  let body: { messages?: unknown; deep?: unknown; key?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const key = typeof body.key === "string" && isMeetingKey(body.key) ? body.key : null;
  const messages = validMessages(body.messages);
  if (!key || !messages) return json(400, { error: "bad_request", message: "Invalid conversation." });

  const limit = assistantRateLimit(viewer.email.toLowerCase());
  if (!limit.ok) return json(429, { error: "rate_limited", message: `Too many messages. Try again in ${limit.retryAfterSec}s.` }, { "Retry-After": String(limit.retryAfterSec) });

  // Ask Sunny's own spend controls, exactly as chat: the monthly budget (and the daily cap where it is on).
  const blocked = await modelSpendGuard({ userId: viewer.userId, role: viewer.role });
  if (blocked) return json(429, { error: "budget", message: blocked.content });

  // The Hub's prompt, models and tools, for this person and this meeting (404 when they may not open it here).
  const config = readConfig(await callHub("assistant-config", viewer.email, { key, pathname: `/meetings/${key}` }));
  if (!config) return json(404, { error: "not_found" });

  return streamHubAssistant({ config, messages, deep: body.deep === true, email: viewer.email, userId: viewer.userId, meetingKey: key, signal: req.signal });
}

/** Whether the panel should show the chat. Returns no secrets. */
export async function GET() {
  return json(200, { configured: Boolean(process.env.ANTHROPIC_API_KEY) });
}
