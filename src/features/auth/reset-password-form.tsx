"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

/**
 * ============================================================================
 * SET A NEW PASSWORD.
 * ============================================================================
 *
 * Reached with a session ALREADY ESTABLISHED, by one of two routes: `/auth/
 * callback` exchanged a `?code=` for it, or `/auth/accept` consumed a
 * `#access_token=` fragment. Either way this screen never handles a token — it
 * checks that a session exists and calls `updateUser`. That separation is what
 * keeps a recovery or invitation token out of this component, out of its state,
 * and out of anything it might log.
 *
 * It then asks the server to move an INVITED profile to active. Setting a
 * password is not by itself enough to use Ask Sunny, and somebody who stopped
 * here would hold a working credential the application still refuses.
 *
 * The minimum length is a floor this form enforces so somebody is told before
 * submitting; the real policy lives in Supabase Auth's own settings, which is
 * the only place that can enforce it for every path in.
 *
 * NO PASSWORD IS STORED, HASHED OR COMPARED HERE. The value goes to Supabase
 * Auth and is cleared from state on success.
 */

const MIN_LENGTH = 12;

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<"checking" | "ok" | "no-session">("checking");

  /*
   * A LINK THAT NO LONGER WORKS MUST SAY SO BEFORE THE FORM IS FILLED IN.
   *
   * Recovery links are single-use and short-lived, so the common failure is a
   * link that was already used or has expired. Checking on mount means the
   * person is told immediately rather than after typing a password twice.
   *
   * `getUser()` rather than `getSession()`, for the same reason as everywhere
   * else: it asks the auth server instead of decoding a cookie.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error: failure } = await getSupabaseBrowserClient().auth.getUser();
        if (cancelled) return;
        setReady(failure || !data?.user ? "no-session" : "ok");
      } catch {
        if (!cancelled) setReady("no-session");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const { error: failure } = await getSupabaseBrowserClient().auth.updateUser({
        password,
      });
      if (failure) {
        /*
         * Surfaced, unlike the sign-in failure. There is no enumeration risk
         * here — the session already proves who this is — and the message is
         * the only way somebody learns their password was rejected for being
         * too weak or previously used.
         */
        setError(failure.message);
        setBusy(false);
        return;
      }

      setPassword("");
      setConfirm("");

      /*
       * ACCEPTING THE INVITATION IS A SEPARATE STEP, and it happens here
       * because here is where we know the password was actually set.
       *
       * An invited profile is REFUSED by the auth provider, so somebody who
       * set a password and stopped would still be locked out — with a working
       * credential and no way in, which is the worst of both. The endpoint
       * takes no body and no id: the database moves the caller's own row from
       * invited to active using `auth.uid()`, and can do nothing else.
       *
       * It is idempotent, so this is safe for somebody who was already active
       * and simply used Forgot Password.
       */
      let landing = "/";
      try {
        const response = await fetch("/api/auth/accept-invitation", { method: "POST" });
        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          /*
           * The PASSWORD WAS CHANGED and the activation was refused — a
           * disabled account, or one with no profile. Saying so plainly beats
           * navigating into the app and bouncing them at the door, which reads
           * as the new password not having worked.
           */
          setError(
            (payload as { error?: string } | null)?.error ??
              "Your password was changed, but your account is not active. Ask an administrator.",
          );
          setBusy(false);
          return;
        }

        const next = (payload as { landing?: string } | null)?.landing;
        // A path only, and only a same-site one.
        if (typeof next === "string" && next.startsWith("/") && !next.startsWith("//")) {
          landing = next;
        }
      } catch {
        /*
         * The activation could not be reached. The password change already
         * succeeded, so sending them into the app is right: if the profile is
         * still invited the page guard returns them to sign-in, which is
         * recoverable, and a retry of this step is one more sign-in away.
         */
      }

      /*
       * `updateUser` leaves the session in place, so the person is now signed
       * in. Refresh first so the server re-renders knowing that, then send them
       * to the screen their role can actually open.
       */
      router.refresh();
      router.replace(landing);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The password could not be changed right now.",
      );
      setBusy(false);
    }
  }

  if (ready === "checking") {
    return (
      <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Checking your reset link…
      </p>
    );
  }

  if (ready === "no-session") {
    return (
      <div className="mt-8 space-y-4">
        <Notice tone="attention" title="This reset link is no longer valid">
          Password reset links can be used once and expire shortly after they
          are sent. Request a new one to continue.
        </Notice>
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
      {error ? (
        <Notice tone="attention" title="Could not set your password">
          {error}
        </Notice>
      ) : null}

      <FieldGroup label="New password" htmlFor="new-password">
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
      </FieldGroup>

      <FieldGroup label="Confirm new password" htmlFor="confirm-password">
        <Input
          id="confirm-password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          disabled={busy}
        />
      </FieldGroup>

      <p className="text-xs leading-relaxed text-muted-foreground">
        At least {MIN_LENGTH} characters. Ask Sunny never stores your password —
        it is held by Supabase Auth, and nobody here can read it.
      </p>

      <Button type="submit" className="w-full" disabled={busy || !password || !confirm}>
        {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
        {busy ? "Saving…" : "Set password and continue"}
      </Button>
    </form>
  );
}
