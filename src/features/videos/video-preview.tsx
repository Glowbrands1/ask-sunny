"use client";

import * as React from "react";
import { Play } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * ============================================================================
 * A REAL FRAME FROM A PRIVATE VIDEO, ON A GRID CARD
 * ============================================================================
 *
 * The card used to show a geometric placeholder, which told a manager nothing
 * about which video they were looking at. This shows an actual early frame —
 * without making the bucket public, without a second playback implementation,
 * and without pulling a library of megabytes to draw a grid.
 *
 * FOUR THINGS KEEP IT CHEAP:
 *
 *   LAZY. Nothing is fetched until the card is actually on screen. An
 *   IntersectionObserver triggers the request, so a library of forty videos
 *   costs one signed URL per card the reader scrolled to, not forty.
 *
 *   `preload="metadata"`. The browser fetches the container header and enough
 *   to render a frame, then stops. `auto` would stream whole videos into a
 *   grid nobody has pressed play on.
 *
 *   A MEDIA FRAGMENT. The source carries `#t=1`, which asks for a frame one
 *   second in rather than the first — the first frame of a real recording is
 *   very often black or a fade-in. It is a hint: a video shorter than a second
 *   simply shows what it has.
 *
 *   NO AUTOPLAY, MUTED, NOT LOOPED. It is a still image that happens to be a
 *   video element. Nothing moves and nothing makes sound, so there is nothing
 *   for a reduced-motion preference to suppress and no autoplay policy to fall
 *   foul of.
 *
 * THE URL IS BORROWED, NOT KEPT. It comes from the same authorized
 * `/api/videos/:id/playback` route the full player uses — `view_videos`
 * checked server-side, short-lived, minted per request — and lives only in this
 * component's state. Nothing writes it to storage, and a reload fetches a fresh
 * one.
 *
 * AND IT FAILS INVISIBLY. Any problem — an unauthorised viewer, an expired
 * link, a codec the browser will not decode, a pending upload with no object —
 * renders `fallback`, which is the placeholder that was always there. A card
 * that cannot preview is a card, not an error.
 */
export function VideoPreview({
  videoId,
  className,
  fallback,
}: {
  videoId: string;
  className?: string;
  /** The geometric placeholder. Shown before, and instead of, a real frame. */
  fallback: React.ReactNode;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  /**
   * Lazily initialised rather than set from inside the effect.
   *
   * Where there is no IntersectionObserver — jsdom, an older browser — there is
   * no lazy signal, so the preview is simply requested. Degrading to eager
   * beats degrading to never, and deciding it here rather than in the effect
   * body avoids a cascading render for the common case.
   *
   * Both branches render the fallback on the first pass, so the server and the
   * client agree on markup whatever this resolves to.
   */
  const [visible, setVisible] = React.useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  /* Ask only once the card is on screen. */
  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    // Already visible (no observer available), so there is nothing to watch for.
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // A little ahead of the viewport, so a frame is ready by the time a
      // scrolling reader arrives at it.
      { rootMargin: "200px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(`/api/videos/${encodeURIComponent(videoId)}/playback`);
        if (cancelled) return;

        if (!response.ok) {
          // Not surfaced as an error anywhere: a card that cannot preview
          // simply keeps its placeholder.
          setFailed(true);
          return;
        }

        const payload = (await response.json()) as { url?: string };
        if (cancelled) return;

        if (typeof payload.url === "string") setUrl(payload.url);
        else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [visible, videoId]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {url && !failed ? (
        <>
          <video
            // A STILL, NOT A CLIP. Muted, no autoplay, no loop, no controls —
            // the card's own click opens the real player.
            muted
            playsInline
            preload="metadata"
            controls={false}
            tabIndex={-1}
            aria-hidden
            onError={() => setFailed(true)}
            className="size-full rounded-[var(--radius-md)] bg-black object-cover"
          >
            {/* `#t=1` asks for a frame a second in — a real recording's first
                frame is often black. */}
            <source src={`${url}#t=1`} />
          </video>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex size-9 items-center justify-center rounded-full bg-surface/85 shadow-soft">
              <Play className="size-3.5 translate-x-px fill-current" />
            </span>
          </span>
        </>
      ) : (
        fallback
      )}
    </div>
  );
}
