"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, MailCheck, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

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

/** Where the recovery link lands. Must be an allowed redirect in Supabase Auth. */
function callbackUrl(): string {
  /*
   * `window.location.origin` rather than a configured site URL, deliberately.
   * Vercel gives every preview deployment its own hostname, so a hard-coded or
   * env-configured origin sends a person clicking the link in their email to a
   * DIFFERENT deployment than the one they asked from — where the cookie they
   * are about to be given is useless. The origin the request came from is the
   * origin that should handle the callback.
   *
   * The hostname must still be registered in Supabase Auth's redirect
   * allowlist, which is where the actual restriction lives; a wildcard entry
   * for preview URLs is what makes this work there.
   */
  return `${window.location.origin}/auth/callback?next=/reset-password`;
}

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
      /*
       * The result is deliberately ignored. Reporting a failure here would
       * distinguish "unknown address" and "rate limited" from success, which is
       * exactly the disclosure this screen exists to avoid.
       */
      await getSupabaseBrowserClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: callbackUrl(),
      });
    } catch (caught) {
      /*
       * A THROW is different from a failed request: it means the browser client
       * could not be built at all, so this deployment has no Supabase
       * configuration. Naming the missing variables is a diagnostic, not a
       * disclosure — and unlike a rate-limit message it says nothing about
       * whether the address exists.
       */
      setConfigError(
        caught instanceof Error
          ? caught.message
          : "Password reset is unavailable right now.",
      );
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
        <Notice tone="attention" title="Password reset is not configured">
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
