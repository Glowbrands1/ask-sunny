"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

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
 * find out. On success it navigates and lets the SERVER decide: the root layout
 * resolves the profile, the page guard checks the permission, and a credential
 * with no active profile lands back here with a message.
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
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
       * the value is not sitting in a React fiber while the route transition
       * runs.
       */
      setPassword("");

      /*
       * `refresh()` before `replace()`. The cookie was just set by the Supabase
       * client, and the server components rendered for a signed-OUT request are
       * still in the router cache — navigating without invalidating them shows
       * the login screen again for a beat.
       */
      router.refresh();
      router.replace(redirectTo);
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
    <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
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
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
      </FieldGroup>

      <Button type="submit" className="w-full" disabled={busy || !email || !password}>
        {busy ? <Loader2 className="animate-spin" /> : <Lock />}
        {busy ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-xs">
        <Link
          href="/forgot-password"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
