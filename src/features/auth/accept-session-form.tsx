"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

/**
 * ============================================================================
 * ACCEPTING A SESSION DELIVERED IN A URL FRAGMENT.
 * ============================================================================
 *
 * Supabase returns an invitation — and any sign-in link an ADMINISTRATOR sent —
 * as `#access_token=…&refresh_token=…`. A fragment is never transmitted to a
 * server, so no route handler can ever see it. That is why this is a client
 * component and why `/auth/callback`, which is a route handler, could not be
 * made to work for invitations however its Site URL was configured.
 *
 * `/auth/callback` still handles the OTHER shape — `?code=` from the browser's
 * own password-reset request — and is untouched. The two shapes need two
 * entry points because one is readable by a server and the other is not.
 *
 * ============================================================================
 * WHAT HAPPENS TO THE TOKEN
 * ============================================================================
 *
 * It is read from the fragment, handed to `supabase.auth.setSession()`, and
 * dropped. It is never logged, never rendered, never put in component state
 * that survives the call, and never sent to an Ask Sunny endpoint — the only
 * thing that ever receives it is Supabase's own client, which validates it
 * against the auth server.
 *
 * THE FRAGMENT IS SCRUBBED BEFORE ANYTHING ELSE HAPPENS. `history.replaceState`
 * rewrites the CURRENT history entry, so the entry the browser is sitting on
 * stops carrying the token — it is out of the address bar, out of the back
 * button, and out of anything that later reads `document.location`. This is
 * done first, synchronously, before any `await`, so a slow network cannot leave
 * a token sitting in the URL bar of an unattended screen.
 *
 * Doing it ourselves also avoids the library's own cleanup, which assigns
 * `window.location.hash = ""`. That is a same-document NAVIGATION: it adds a
 * new history entry and leaves the previous one — the one holding the token —
 * still in the back stack.
 */

type Phase =
  | { kind: "working" }
  | { kind: "failed"; message: string };

/** What the fragment carried. Never stored, never returned, never logged. */
interface FragmentTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Reads the fragment and REMOVES IT FROM HISTORY in the same synchronous step.
 *
 * Returning either tokens, an error, or nothing — three outcomes that need
 * three different screens, so they are distinguished here rather than by a
 * null check at the call site.
 */
function takeFragment():
  | { outcome: "tokens"; tokens: FragmentTokens }
  | { outcome: "error" }
  | { outcome: "empty" } {
  if (typeof window === "undefined") return { outcome: "empty" };

  const raw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  if (!raw) return { outcome: "empty" };

  const params = new URLSearchParams(raw);

  // Scrub FIRST. Everything below this line runs with a clean URL, whatever it
  // finds, including the error case — a failed link should not leave its
  // parameters on screen either.
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (accessToken && refreshToken) {
    return { outcome: "tokens", tokens: { accessToken, refreshToken } };
  }

  /*
   * Supabase reports a spent or expired link as `error` / `error_description`.
   * The outcome is all that is kept: `error_description` is provider text that
   * would end up rendered on a page, and it tells a person nothing beyond "the
   * link did not work".
   */
  if (params.get("error") || params.get("error_code")) return { outcome: "error" };

  return { outcome: "empty" };
}

const LINK_SPENT =
  "This link is no longer valid. Invitation and sign-in links can be used once and expire shortly after they are sent.";

export function AcceptSessionForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "working" });

  /*
   * Effects run twice in development under StrictMode, and the fragment is gone
   * after the first pass. Without this the second pass would report a spent
   * link over a session that was just established successfully.
   */
  const started = useRef(false);

  const accept = useCallback(async () => {
    const fragment = takeFragment();

    if (fragment.outcome === "error") {
      setPhase({ kind: "failed", message: LINK_SPENT });
      return;
    }

    try {
      const supabase = getSupabaseBrowserClient();

      if (fragment.outcome === "tokens") {
        const { error } = await supabase.auth.setSession({
          access_token: fragment.tokens.accessToken,
          refresh_token: fragment.tokens.refreshToken,
        });
        if (error) {
          // The provider's message is not surfaced — same reasoning as above.
          setPhase({ kind: "failed", message: LINK_SPENT });
          return;
        }
      } else {
        /*
         * No fragment. Either this page was opened directly, or the Supabase
         * client was constructed first and consumed the fragment itself —
         * `detectSessionInUrl` is on by default in the browser and fires during
         * client construction. Asking the auth server whether a session exists
         * distinguishes the two without guessing.
         */
        const { data, error } = await supabase.auth.getUser();
        if (error || !data?.user) {
          setPhase({ kind: "failed", message: LINK_SPENT });
          return;
        }
      }

      /*
       * The session now exists in cookies, so the SERVER can see it. Refresh
       * first — the server components rendered for this request were rendered
       * signed-out, and are still in the router cache.
       */
      router.refresh();
      router.replace("/reset-password");
    } catch (caught) {
      /*
       * A configuration failure, not a link failure: `getSupabaseBrowserClient`
       * throws when the build has no Supabase values, and its message names the
       * missing VARIABLES — which is what somebody debugging a deployment needs
       * and contains no secret.
       */
      setPhase({
        kind: "failed",
        message:
          caught instanceof Error ? caught.message : "This link could not be opened.",
      });
    }
  }, [router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void accept();
  }, [accept]);

  if (phase.kind === "failed") {
    return (
      <div className="mt-8 space-y-4">
        <Notice tone="attention" title="This link did not work">
          {phase.message}
        </Notice>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Ask an administrator to send a new invitation, or use{" "}
          <strong>Forgot your password?</strong> on the sign-in screen if you
          have signed in before.
        </p>
        <Button asChild className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Opening your invitation…
    </p>
  );
}
