import { NextResponse } from "next/server";

import { loadGoogleReviewsChatBlock } from "@/lib/ai/google-reviews-chat-read";
import { HUB_REVIEWS_HEADERS, verifyHubReviewsRequest } from "@/lib/partner/hub-reviews-signature";

/**
 * POST /api/partner/hub-reviews — the Leadership Hub's assistant reads this app's Google reviews (19 Nov 2026).
 *
 * The owner asked for the Hub's assistant to see Google reviews, with every Hub user seeing both brands' reviews. The
 * Hub's SERVER signs each request (`lib/partner/hub-reviews-signature.ts`); nothing here trusts a cookie, and the
 * middleware does not run on `/api`. The answer is the same block the chat reads (`google-reviews-chat-read.ts`): the
 * Google Reviews page's month to date against the goal, this reporting week and last, and, when the question asks,
 * L3, L6, YTD and each month, for every salon (the page's own view for a role with View Google reviews).
 *
 * Fails closed: without HUB_REVIEWS_SECRET every request is refused with 404, so the route does not exist until the
 * secret is set. A bad signature is 401, with no detail. Read only.
 */
export const dynamic = "force-dynamic";

const MAX_BODY = 4_000;
const MAX_QUESTION = 500;

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.HUB_REVIEWS_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await request.text();
  if (body.length > MAX_BODY) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const signed = verifyHubReviewsRequest({
    secret,
    caller: request.headers.get(HUB_REVIEWS_HEADERS.caller),
    timestamp: request.headers.get(HUB_REVIEWS_HEADERS.timestamp),
    signature: request.headers.get(HUB_REVIEWS_HEADERS.signature),
    body,
    now: Date.now(),
  });
  if (!signed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let question = "";
  try {
    const parsed = JSON.parse(body) as { question?: unknown };
    question = typeof parsed.question === "string" ? parsed.question.slice(0, MAX_QUESTION) : "";
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  /* Always read as a Google review question, so the page's figures come back whatever the words were. */
  const block = await loadGoogleReviewsChatBlock({ question: `Google reviews ${question}`.trim(), role: "owner", scope: null });
  if (!block) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ app: "Ask Sunny", text: block.text, figures: block.figures }, { headers: { "cache-control": "no-store" } });
}
