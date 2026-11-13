"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";

import { SparkleIcon } from "./icons";

// The chat loads on first open, not on every page view (as in the Hub).
const AssistantPanel = dynamic(() => import("./AssistantPanel").then((m) => m.AssistantPanel), { ssr: false });

/** The Leadership Hub's floating assistant launcher (src/components/AssistantBubble.tsx), for the DM L10 pages. */
export function AssistantBubble({ meetingKey, scope }: { meetingKey: string; /** "<Ask Sunny user id>:<meeting key>", for this person's chat history. */ scope: string }) {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus());
  }, []);
  return (
    <>
      {everOpened && <AssistantPanel open={open} onClose={close} meetingKey={meetingKey} scope={scope} />}
      <button
        ref={launcher}
        type="button"
        aria-label={open ? "Hide Leadership Assistant" : "Open Leadership Assistant"}
        title={open ? "Hide the chat (it stays as it is)" : "Open the Leadership Assistant"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) return close();
          setEverOpened(true);
          setOpen(true);
        }}
        data-testid="assistant-launcher"
        className="fixed right-(--fab-right) bottom-(--assistant-bottom) z-50 inline-flex size-14 items-center justify-center rounded-full bg-ink text-gold-head shadow-float transition-[translate,box-shadow] hover:shadow-float-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze motion-safe:hover:-translate-y-0.5 [&[aria-expanded=true]]:max-sm:hidden"
      >
        <SparkleIcon width={26} height={26} />
      </button>
    </>
  );
}
