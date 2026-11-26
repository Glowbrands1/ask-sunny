"use client";

import * as React from "react";

import { Dialog, DialogContent } from "@/components/ui/overlays";
import { fetchFormPreviewUrl } from "@/features/forms/forms-fetch";
import { useSession } from "@/lib/session/session-context";

/**
 * VIEW A FORM IN A POP-UP, NOT ANOTHER PAGE (Pau, 26 Nov 2026, of the employee search's View link: "when i click view
 * it says this, i just need a preview pop up please not another tab"). The form's own PDF — the same document Download
 * PDF gives, read under the same per-form check (`authorizeInstance(..., "view")`) — shown in a dialog over the list.
 * Fetched with `?preview=1`, so opening it is not recorded as an export. Same component in both apps.
 */
export function FormPreviewButton({ instanceId, title, label = "View" }: { instanceId: string; title: string; label?: string }) {
  const { role, user } = useSession();
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /** Which opening a fetch belongs to, so a late answer for a pop-up already closed is thrown away. */
  const opening = React.useRef(0);

  function show() {
    const ticket = ++opening.current;
    setUrl(null);
    setError(null);
    setOpen(true);
    fetchFormPreviewUrl(instanceId, role, user.name)
      .then((next) => {
        if (opening.current === ticket) setUrl(next);
        else URL.revokeObjectURL(next);
      })
      .catch((caught: unknown) => {
        if (opening.current === ticket) setError(caught instanceof Error ? caught.message : "That form could not be opened.");
      });
  }

  function onOpenChange(next: boolean) {
    if (next) return;
    opening.current += 1;
    if (url) URL.revokeObjectURL(url);
    setUrl(null);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="font-medium text-primary underline-offset-4 hover:underline"
        aria-label={`${label} ${title}`}
      >
        {label}
      </button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent title={title} wide className="max-w-4xl">
          <div className="h-[75vh] px-2 pb-2">
            {error ? (
              <p role="alert" className="px-4 py-6 text-sm text-foreground">
                {error}
              </p>
            ) : url ? (
              <iframe src={url} title={title} className="h-full w-full rounded-[var(--radius-sm)] border-0 bg-surface-muted" />
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground">Opening the form…</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
