"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { RECOVERY_START_PATH } from "@/lib/auth/routes";

/**
 * ============================================================================
 * CONTINUE TO RESET PASSWORD. The one human step a mail scanner cannot take.
 * ============================================================================
 *
 * A plain HTML form POSTing to `/auth/recovery-start`. That POST — and nothing
 * that can happen on a GET — is what spends the recovery token. It works
 * without JavaScript; the script only disables the button after the first
 * press, so a double click cannot send the token twice and have the second,
 * refused, attempt overwrite the first one's success with "expired".
 *
 * THE TOKEN IS NOT IN THIS COMPONENT. It sits in an HttpOnly cookie the
 * browser attaches to the POST; nothing here can read it, and no hidden field
 * carries it. `hasLink` only says whether one is being held.
 */
export function RecoveryContinueForm({
  hasLink,
  retry,
}: {
  hasLink: boolean;
  retry: boolean;
}) {
  const [busy, setBusy] = useState(false);

  if (!hasLink) {
    return (
      <div className="mt-8 space-y-4">
        <Notice tone="attention" title="Open the link from your email">
          This page continues a password reset, but no reset link is open in
          this browser. Use the link in the most recent reset email, or request
          a new one.
        </Notice>
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
        <p className="text-center text-xs">
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form
      className="mt-8 space-y-4"
      method="post"
      action={RECOVERY_START_PATH}
      onSubmit={(event) => {
        if (busy) {
          event.preventDefault();
          return;
        }
        setBusy(true);
      }}
    >
      {retry ? (
        <Notice tone="attention" title="We could not reach the sign-in service">
          Your link has not been used. Please try again in a moment.
        </Notice>
      ) : null}

      <p className="text-sm leading-relaxed text-muted-foreground">
        Your reset link is ready. Press the button below to choose a new
        password. The link can be used once.
      </p>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}
        {busy ? "Opening…" : "Continue to reset password"}
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
