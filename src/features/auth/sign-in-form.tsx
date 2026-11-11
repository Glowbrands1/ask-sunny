"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { safeInternalUrl } from "@/lib/auth/safe-navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import { invitedSignInAcceptsEnabled } from "@/lib/auth/invited-signin-flag";

/**
 * ============================================================================
 * THE REAL SIGN-IN FORM.
 * ============================================================================
 *
 * The password goes straight to Supabase Auth and nowhere else. It is held in
 * component state only while the field is on screen, never written to storage,
 * never logged, never sent to an Ask Sunny endpoint. Ask Sunny has no password
 * table of its own and hashes nothing itself — that is Supabase Auth's job, and
 * a second implementation of it would be a credential store we have no business
 * owning.
 *
 * WHAT THIS DOES NOT DECIDE. Signing in proves somebody holds a credential. It
 * says nothing about what they may do, and this component makes no attempt to
 * find out — it does not read a role, and could not: the role lives in
 * `app_users` and is resolved server-side. On success it navigates to `/` and
 * lets the SERVER decide everything: the root layout resolves the profile, and
 * the page guard sends a role that cannot open the Overview onward to the
 * screen it can. A credential with no active profile lands back here with a
 * message.
 */

/**
 * One message for every failure. Deliberately.
 *
 * Supabase distinguishes "no such user" from "wrong password", and passing that
 * distinction on would turn this form into an account-enumeration oracle:
 * submit an address, learn whether it is a real employee's. So both are the
 * same sentence, and rate limiting stays Supabase's to enforce.
 */
const SIGN_IN_FAILED =
  "That email and password combination did not work. Check both and try again.";

export function SignInForm({ redirectTo = "/" }: { redirectTo?: string }) {
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  /*
   * Messages this screen may have been SENT here with, rather than ones it
   * produced. A person bounced out of the app for lacking a profile needs to
   * know why they cannot get in, and the bounce happens on the server.
   */
  const notice = params.get("notice");
  const signedOut = params.get("signedOut") === "1";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const { error: failure } = await getSupabaseBrowserClient().auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (failure) {
        // The provider's own message is not surfaced — see SIGN_IN_FAILED.
        setError(SIGN_IN_FAILED);
        setBusy(false);
        return;
      }

      /*
       * Clear the password from state the instant it is no longer needed. It
       * would go out of scope on navigation anyway; doing it explicitly means
       * the value is not sitting in a React fiber while the document unloads.
       */
      setPassword("");

      /*
       * NEXT_PUBLIC_INVITED_SIGNIN_ACCEPTS_ENABLED: a password that works is an
       * accepted invitation. An account still `invited` — its link opened by a
       * mail scanner before the person, so the set-password screen that
       * accepts it never ran — becomes active here; the database refuses a
       * disabled account, and an active one is unchanged. Best effort: the
       * server's own check still decides what this person sees next.
       */
      if (invitedSignInAcceptsEnabled()) {
        await fetch("/api/auth/accept-invitation", { method: "POST" }).catch(() => undefined);
      }

      /*
       * ====================================================================
       * A REAL DOCUMENT NAVIGATION, NOT A CLIENT-SIDE ONE.
       * ====================================================================
       *
       * This was `router.refresh()` followed by `router.replace(redirectTo)`,
       * and on the root route it left people staring at "Signing in…" until
       * they refreshed by hand. Three things combined:
       *
       *   The login screen is rendered INLINE by `AppShell` when the session is
       *   signed out, so somebody signing in at `/` is already ON `/`. A
       *   `replace` to the URL you are already on is a no-op — there is no
       *   navigation for Next to perform.
       *
       *   That left `refresh()` as the only thing that could swap the tree, and
       *   it was issued synchronously alongside the `replace` it raced with.
       *
       *   Nothing ever set `busy` back to false on the success path. So when
       *   neither took effect there was no recovery and no message — just a
       *   button that said "Signing in…" forever.
       *
       * A full document request is what a manual refresh was doing, and it
       * works for the reason that matters: the browser sends the session cookie
       * the Supabase client has already written, so RootLayout resolves the
       * identity server-side on the very first render. `_saveSession` is
       * awaited inside `signInWithPassword`, so that cookie exists by the time
       * this line runs — there is nothing to wait for and nothing to poll.
       *
       * `replace` rather than `assign`, so the back button does not return to a
       * login form the person has already passed.
       *
       * `busy` is deliberately left true: the document is being torn down, and
       * flipping the button back to "Sign in" first would be a flicker
       * suggesting the attempt had failed.
       *
       * The destination is same-origin because `safeInternalUrl` compares the
       * PARSED result against this origin — not because the string looked
       * internal. That rule is shared with the legacy callback and the
       * activation landing, so all three cannot drift apart; see
       * `lib/auth/safe-navigation.ts` for why the distinction matters.
       */
      window.location.replace(safeInternalUrl(redirectTo, window.location.origin));
    } catch (caught) {
      /*
       * A configuration failure, not a credential one: `getSupabaseBrowserClient`
       * throws when the build has no Supabase values. Its message names the
       * missing VARIABLES, which is exactly what somebody debugging a
       * deployment needs and contains no secret.
       */
      setError(
        caught instanceof Error ? caught.message : "Sign-in is unavailable right now.",
      );
      setBusy(false);
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
      {signedOut ? (
        <Notice tone="neutral">You have been signed out.</Notice>
      ) : null}
      {notice ? <Notice tone="attention">{notice}</Notice> : null}
      {error ? (
        <Notice tone="attention" title="Could not sign in">
          {error}
        </Notice>
      ) : null}

      <FieldGroup label="Work email" htmlFor="login-email">
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="you@suntancity.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />
      </FieldGroup>

      <FieldGroup label="Password" htmlFor="login-password">
        <div className="relative">
          <Input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            data-reveal=""
            className="pr-11"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
          {/* Show/hide only changes how the field renders; the value never
              leaves component state either way. */}
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute top-1/2 right-3 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            {showPassword ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
          </button>
        </div>
      </FieldGroup>

      <Button type="submit" className="w-full" disabled={busy || !email || !password}>
        {busy ? <Loader2 className="animate-spin" /> : <Lock />}
        {busy ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-sm">
        <Link
          href="/forgot-password"
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
