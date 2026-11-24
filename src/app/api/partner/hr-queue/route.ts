import { NextResponse } from "next/server";

import { SIBLING_HR_APP } from "@/lib/config/app-switcher";
import { hrQueueForPartner } from "@/lib/partner/sibling-hr-queue";
import { SIBLING_HR_HEADERS, verifySiblingHrRequest } from "@/lib/partner/sibling-hr-signature";

/**
 * POST /api/partner/hr-queue — the sibling app reads the forms waiting for its HR approver here (owner, 23 Nov 2026:
 * "1 tab for sunny 1 tab for bubbles"), so the approver sees both apps' queues from either one.
 *
 * Only the sibling's SERVER may ask, signed with SIBLING_HR_SECRET (`lib/partner/sibling-hr-signature.ts`); nothing
 * here trusts a cookie, and the middleware does not run on `/api`. It answers only for an email that is an active
 * account and an active HR approver HERE (`hrQueueForPartner`), with the minimum the tab shows, never a form's values
 * or HR's notes. Read only: approving happens on this app's own review page, under this app's own sign-in.
 *
 * Fails closed: without SIBLING_HR_SECRET every request is refused with 404, so the route does not exist until the
 * secret is set. A bad signature is 401, with no detail.
 */

export const dynamic = "force-dynamic";

const MAX_BODY = 2_000;

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SIBLING_HR_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await request.text();
  if (body.length > MAX_BODY) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const signed = verifySiblingHrRequest({
    secret,
    expectedCaller: SIBLING_HR_APP.siblingAppId,
    caller: request.headers.get(SIBLING_HR_HEADERS.caller),
    timestamp: request.headers.get(SIBLING_HR_HEADERS.timestamp),
    signature: request.headers.get(SIBLING_HR_HEADERS.signature),
    body,
    now: Date.now(),
  });
  if (!signed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let approverEmail: unknown;
  try {
    approverEmail = (JSON.parse(body) as { approverEmail?: unknown }).approverEmail;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    return NextResponse.json(await hrQueueForPartner(approverEmail), { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
