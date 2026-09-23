import { NextResponse } from "next/server";

import { supabasePublicConfigured } from "@/lib/config/runtime";
import { normalizeEmail } from "@/lib/admin/user-directory";
import { recoveryRedirectTarget } from "@/lib/admin/redirect-target";
import { getSupabaseRecoveryClient } from "@/lib/supabase/recovery-client";

/**
 * ============================================================================
 * POST /api/auth/forgot-password — the public "Forgot password?" request.
 * ============================================================================
 *
 * UNAUTHENTICATED ON PURPOSE. The person using it has forgotten their password
 * and is signed out; requiring a session would lock out exactly them. No
 * administrator is involved.
 *
 * It asks Supabase to email a reset link, SERVER-SIDE, through a client that
 * uses the implicit flow. The link then returns to `/reset-password` as a
 * `#access_token=…` fragment that page already reads, in whatever browser the
 * email is opened. The browser-side request it replaces used PKCE, whose link
 * can only be completed in the browser that asked. See
 * `lib/supabase/recovery-client.ts`.
 *
 * ============================================================================
 * THE ANSWER IS THE SAME WHETHER THE ADDRESS EXISTS OR NOT
 * ============================================================================
 *
 * Every well-formed request gets the identical `200 { ok: true }`: a known
 * address, an unknown one, a rate limit, a provider failure. Anything else
 * would let a stranger learn which addresses belong to real employees. The two
 * other answers say nothing about any account: `400` for input that is not an
 * email address at all, and `503` when this deployment has no Supabase
 * configuration.
 *
 * NOTHING SENSITIVE IS LOGGED. Not the address, not the request body, not the
 * provider's message (which can name the address). A refused request logs only
 * Supabase's machine error code — e.g. `over_email_send_rate_limit` — so a
 * failure can be diagnosed without recording who asked.
 *
 * The redirect target is compiled in (`<site>/reset-password`), never read from
 * the request, so the link cannot be pointed anywhere else.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Only a short snake_case code is ever logged — never free text. */
function safeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z0-9_]{1,64}$/.test(code) ? code : "unknown";
}

export async function POST(request: Request) {
  if (!supabasePublicConfigured()) {
    return NextResponse.json(
      {
        error:
          "Password reset is not configured for this deployment. Missing: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
      },
      { status: 503, headers: NO_STORE },
    );
  }

  const body: unknown = await request.json().catch(() => null);

  let email: string;
  try {
    email = normalizeEmail((body as { email?: unknown } | null)?.email);
  } catch {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const { error } = await getSupabaseRecoveryClient().auth.resetPasswordForEmail(email, {
      redirectTo: recoveryRedirectTarget(request),
    });
    if (error) {
      console.warn(`[forgot-password] recovery request not accepted: ${safeErrorCode(error)}`);
    }
  } catch (error) {
    console.warn(`[forgot-password] recovery request failed: ${safeErrorCode(error)}`);
  }

  // Identical whatever happened above.
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
