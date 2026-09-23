"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, MailCheck, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";

/**
 * ============================================================================
 * FORGOT PASSWORD.
 * ============================================================================
 *
 * THE ANSWER IS THE SAME WHETHER THE ADDRESS EXISTS OR NOT, and that is the
 * only interesting decision in this file. A form that says "no account with
 * that email" is an account-enumeration oracle: anyone can submit addresses and
 * learn which ones belong to real employees. So the screen confirms that a link
 * has been sent if the address is one we know, and says nothing more.
 *
 * Supabase's own `resetPasswordForEmail` behaves the same way — it does not
 * report whether the address matched — so this is reporting the truth rather
 * than concealing it. The provider's error is still swallowed for the same
 * reason: a rate-limit message differs from a success message, and the
 * difference is itself a signal.
 *
 * NOTHING IS LOGGED. The recovery link contains a single-use token that grants
 * a password change; a console line carrying one would be a credential in a log
 * aggregator.
 */

/**
 * The Ask Sunny endpoint that asks Supabase for the reset email.
 *
 * SERVER-SIDE, deliberately. This form used to call `resetPasswordForEmail`
 * from the browser, whose `@supabase/ssr` client uses PKCE: the link came back
 * as `?code=` and could only be completed in the SAME browser that asked,
 * because only that browser held the code verifier. Opened on another device or
 * in a mail app's browser, a perfectly valid link could not be used.
 *
 * The endpoint uses an implicit-flow client instead, so the link returns to
 * `/reset-password` as a `#access_token=` fragment that page reads in any
 * browser. It also chooses the redirect target itself; this form sends only the
 * address.
 */
const FORGOT_PASSWORD_ENDPOINT = "/api/auth/forgot-password";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setConfigError(null);

    try {
      const response = await fetch(FORGOT_PASSWORD_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
        cache: "no-store",
      });

      /*
       * Every well-formed request gets the same success answer from the
       * server, whether or not the address has an account, so there is nothing
       * here to distinguish. Only two answers are shown: a `503` means this
       * deployment has no Supabase configuration (a diagnostic about the build,
       * not about any account), and a `400` means the input is not an address.
       */
      if (response.status === 503 || response.status === 400) {
        const payload: unknown = await response.json().catch(() => null);
        setConfigError(
          (payload as { error?: string } | null)?.error ??
            "Password reset is unavailable right now.",
        );
        setBusy(false);
        return;
      }
    } catch {
      /*
       * The network failed before any answer arrived. Nothing about the
       * address can be learned from this, and the person should know to retry
       * rather than wait for an email that was never requested.
       */
      setConfigError("Password reset could not be reached. Check your connection and try again.");
      setBusy(false);
      return;
    }

    setSent(true);
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="mt-8 space-y-4">
        <Notice tone="accent" icon={<MailCheck />} title="Check your email">
          If <strong>{email.trim()}</strong> has an Ask Sunny account, a
          password reset link is on its way. The link can be used once and
          expires shortly.
        </Notice>
        <p className="text-sm text-muted-foreground">
          Nothing arrived? Check the spam folder, then ask an administrator to
          confirm the address on your account.
        </p>
        <Button asChild variant="secondary" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
      {configError ? (
        <Notice tone="attention" title="Password reset could not be requested">
          {configError}
        </Notice>
      ) : null}

      <p className="text-sm leading-relaxed text-muted-foreground">
        Enter your work email and we will send you a link to set a new password.
      </p>

      <FieldGroup label="Work email" htmlFor="forgot-email">
        <Input
          id="forgot-email"
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

      <Button type="submit" className="w-full" disabled={busy || !email}>
        {busy ? <Loader2 className="animate-spin" /> : <Send />}
        {busy ? "Sending…" : "Send reset link"}
      </Button>

      <p className="text-center text-xs">
        <Link
          href="/login"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
