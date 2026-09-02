import { NextResponse, type NextRequest } from "next/server";

import {
  isProtectedPath,
  REVIEW_COOKIE,
  REVIEW_GATE_PATH,
  reviewAccessState,
} from "@/lib/reporting-review/gate";

/**
 * THE STAKEHOLDER-REVIEW GATE, ENFORCED BEFORE ANYTHING RENDERS.
 *
 * Middleware rather than a check inside the page, and the difference is not
 * stylistic. The dashboard is a server component that queries Supabase for real
 * salon financials as part of rendering. A guard inside the page would run
 * AFTER that work had begun; a redirect from here means an unauthenticated
 * request never reaches the database at all.
 *
 * It also means there is ONE place to look. A page-level guard is a thing
 * somebody forgets to add to the next route; `isProtectedPath` covers the
 * prefix and everything nested under it, so a drill-down page added later is
 * protected the moment it exists.
 *
 * TEMPORARY. This file, `lib/reporting-review/` and the gate page are the whole
 * mechanism, and they are meant to be deleted together once employee login
 * ships — whichever provider that turns out to be, and it is not assumed to be
 * any particular one. Nothing else in the app imports any of it.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!isProtectedPath(pathname)) return NextResponse.next();

  /*
   * "granted" is the only state that opens the door. A deployment with no
   * password configured reports "unconfigured" and is treated exactly like a
   * refusal here — the gate page says so to an operator, but nobody gets in.
   */
  const state = await reviewAccessState(request.cookies.get(REVIEW_COOKIE)?.value);
  if (state === "granted") return NextResponse.next();

  /*
   * REDIRECT, NOT REWRITE. The reviewer needs to see that they are at a
   * password prompt and needs a URL they can reload; a rewrite would leave the
   * dashboard's address showing while the gate rendered, which reads like the
   * dashboard is broken rather than closed.
   *
   * `next` carries only an internal path, and `safeNextPath` re-validates it on
   * the way back. No secret is ever put in a query string.
   */
  const gate = request.nextUrl.clone();
  gate.pathname = REVIEW_GATE_PATH;
  gate.search = "";
  gate.searchParams.set("next", `${pathname}${search}`);

  return NextResponse.redirect(gate);
}

export const config = {
  /*
   * Matched narrowly. Middleware runs on every matched request, and the rest of
   * this prototype has no reason to pay for it.
   */
  matcher: ["/reports/salon-performance", "/reports/salon-performance/:path*"],
};
