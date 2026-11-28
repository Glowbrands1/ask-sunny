"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { useSession } from "@/lib/session/session-context";

import { markWhatsNewSeen } from "./whats-new-seen";

/** Opening What's New marks the newest entry this person sees as seen, so the sidebar's "New" dot goes. */
export function MarkWhatsNewSeen({ latest }: { latest: string | null }) {
  const { user } = useSession();
  useEffect(() => {
    markWhatsNewSeen(user?.id ?? "", latest);
  }, [user?.id, latest]);
  return null;
}

/**
 * An entry's screenshot: a thumbnail under "Now"; pressing it (mouse, Enter or Space) opens it full size in a modal
 * dialog (the native <dialog>: focus moves in, Escape or Close shuts it, focus returns to the thumbnail).
 */
export function WhatsNewScreenshot({ src, alt }: { src: string; alt: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="mt-1 block w-full max-w-xl overflow-hidden rounded-lg border border-border bg-muted text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`Enlarge screenshot: ${alt}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a static file under public/, already sized */}
        <img src={src} alt={alt} loading="lazy" className="block h-auto w-full" />
      </button>
      <dialog
        ref={dialog}
        aria-label={alt}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
        className="m-auto max-h-[92vh] max-w-[min(1200px,94vw)] rounded-xl border border-border bg-background p-0 backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <p className="text-sm text-muted-foreground">{alt}</p>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-hover-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label="Close screenshot"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- the same static file, full size */}
        <img src={src} alt={alt} className="block h-auto max-h-[80vh] w-auto max-w-full" />
      </dialog>
    </>
  );
}
