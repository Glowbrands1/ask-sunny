"use client";

import { useSyncExternalStore } from "react";
import { Check, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * ============================================================================
 * THE BOX WHILE DICTATING (VOICE_INPUT_ENABLED)
 * ============================================================================
 *
 * The owner's reference (27 Nov 2026), its layout and not its look: the box turns into the words so far, growing as
 * they are said; under them a full-width row of thin bars moving with the voice (flat when silent); on the right a
 * light ✕ (stop and drop) and a dark ✓ (stop and send). Nothing else shows in the box while dictating. Sunny's own
 * colours: the ✓ is the same yellow as Send.
 *
 * With reduced motion asked for, the bars do not move: a still row of dots, and the words "Listening" in their place.
 * The live words are announced politely; the two buttons have names ("Cancel dictation", "Send").
 */

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(reducedMotionQuery).matches;
}

export interface LiveDictationPanelProps {
  readonly text: string;
  readonly levels: readonly number[];
  readonly seconds: number;
  /** Ending the session and checking the names: the buttons wait. */
  readonly finishing: boolean;
  /** The socket is opening: no words yet. */
  readonly connecting?: boolean;
  readonly onCancel: () => void;
  readonly onSend: () => void;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function LiveDictationPanel({ text, levels, seconds, finishing, connecting = false, onCancel, onSend }: LiveDictationPanelProps) {
  const reduced = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const hearing = levels.slice(-6).some((level) => level > 0.08);

  return (
    <div
      role="group"
      aria-label="Dictating"
      data-testid="live-dictation"
      className="flex h-full min-h-11 w-full items-center gap-2 rounded-[inherit] bg-surface py-1.5 pr-1.5 pl-4 sm:gap-3 sm:pl-5"
    >
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <p
          aria-live="polite"
          data-testid="live-dictation-text"
          className={cn("m-0 line-clamp-3 text-[14px] leading-snug", text ? "text-foreground" : "text-placeholder-foreground")}
        >
          {text || (connecting ? "Starting the microphone…" : "Listening… start speaking")}
        </p>
        <div className="flex items-center gap-2">
          {reduced ? (
            <div data-testid="live-dictation-still" className="flex h-4 flex-1 items-center gap-[3px]" aria-hidden>
              {levels.map((_, index) => (
                <span key={index} className="size-[2px] rounded-full bg-muted-foreground/50" />
              ))}
            </div>
          ) : (
            <div data-testid="live-dictation-wave" className="flex h-4 flex-1 items-center gap-[2px]" aria-hidden>
              {levels.map((level, index) => (
                <span
                  key={index}
                  className={cn("w-[2px] flex-1 rounded-full", level > 0.04 ? "bg-foreground/70" : "bg-muted-foreground/40")}
                  style={{ height: `${Math.max(2, Math.round(level * 16))}px` }}
                />
              ))}
            </div>
          )}
          <span className="shrink-0 text-[11px] font-semibold text-muted-foreground tabular-nums" data-testid="live-dictation-timer">
            {reduced ? `${hearing ? "Hearing you" : "Listening"} · ${clock(seconds)}` : clock(seconds)}
          </span>
        </div>
      </div>
      <button
        type="button"
        aria-label="Cancel dictation"
        onClick={onCancel}
        disabled={finishing}
        className="grid size-10 shrink-0 place-items-center rounded-xl bg-hover-surface text-foreground transition-opacity hover:opacity-80 disabled:opacity-40"
      >
        <X aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Send"
        onClick={onSend}
        disabled={finishing || connecting}
        className="clay-sun-button grid size-10 shrink-0 place-items-center rounded-xl text-brand-yellow-foreground transition-opacity disabled:opacity-40"
      >
        {finishing ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : <Check aria-hidden className="size-4" strokeWidth={2.75} />}
      </button>
    </div>
  );
}
