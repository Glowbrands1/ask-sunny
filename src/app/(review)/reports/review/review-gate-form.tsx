"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { FieldGroup, Input } from "@/components/ui/field";
import { submitReviewPassword } from "./actions";

/**
 * The password form.
 *
 * A PLAIN FORM POSTING TO A SERVER ACTION. The submitted value goes straight
 * into the request body and is compared on the server; it never enters a query
 * string, never lands in a browser history entry, and no part of this component
 * knows what the real password is — only whether the server accepted it.
 *
 * `useActionState` renders the refusal without a navigation, so a mistyped
 * password does not cost a page load and does not leave the attempt in history.
 */
export function ReviewGateForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(submitReviewPassword, {
    error: null,
  });

  return (
    <form action={formAction} className="space-y-4">
      {/* Where to go on success. An internal path only — re-validated server-side. */}
      <input type="hidden" name="next" value={next} />

      <FieldGroup label="Password" htmlFor="review-password">
        <Input
          id="review-password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          aria-describedby={state.error ? "review-error" : undefined}
        />
      </FieldGroup>

      {state.error ? (
        // Wrapped rather than passed through: `Notice` takes no id/role, and a
        // refusal has to be announced to a screen reader, not just drawn.
        <div id="review-error" role="alert">
          <Notice tone="attention">{state.error}</Notice>
        </div>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Checking…" : "Continue"}
      </Button>
    </form>
  );
}
