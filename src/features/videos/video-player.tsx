"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Notice } from "@/components/ui/feedback";
import type { TrainingVideoPlaybackResponse } from "@/lib/videos/types";

/**
 * ============================================================================
 * PLAYBACK, FROM A PRIVATE BUCKET
 * ============================================================================
 *
 * The component holds no URL of its own. It asks the server for one when it
 * mounts, and the server mints a short-lived signed link only after checking
 * `view_videos`. So a viewer whose access is revoked loses their next view
 * rather than keeping a permanent link, and the bucket never becomes public.
 *
 * THE BYTES COME FROM SUPABASE, NOT FROM THIS APP. The `src` points straight at
 * storage, so the browser's range requests reach something that understands
 * them and the timeline can be scrubbed. Proxying the stream through a
 * serverless function would break seeking and bill an invocation per scrub.
 *
 * `preload="metadata"` fetches the duration and the first frames and stops.
 * `preload="auto"` on a library page would pull hundreds of megabytes for a
 * video nobody pressed play on.
 */
export function VideoPlayer({
  videoId,
  title,
}: {
  videoId: string;
  title: string;
}) {
  const [state, setState] = React.useState<
    | { status: "loading" }
    | { status: "ready"; playback: TrainingVideoPlaybackResponse }
    | { status: "error"; message: string }
  >({ status: "loading" });

  React.useEffect(() => {
    let live = true;

    async function load() {
      try {
        const response = await fetch(`/api/videos/${encodeURIComponent(videoId)}/playback`);
        const payload = (await response.json().catch(() => null)) as
          | (TrainingVideoPlaybackResponse & { error?: string })
          | null;

        if (!live) return;

        if (!response.ok || !payload?.url) {
          setState({
            status: "error",
            // The server's own message. It never names a storage path or a
            // provider error, both of which its handlers deliberately withhold.
            message: payload?.error ?? "This video could not be opened right now.",
          });
          return;
        }

        setState({ status: "ready", playback: payload });
      } catch {
        if (live) {
          setState({
            status: "error",
            message: "The playback link could not be fetched. Check your connection.",
          });
        }
      }
    }

    void load();
    return () => {
      live = false;
    };
  }, [videoId]);

  if (state.status === "loading") {
    return (
      <div
        className="flex aspect-video w-full items-center justify-center rounded-[var(--radius-lg)] border border-border bg-surface-muted"
        role="status"
      >
        <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Preparing playback…
        </span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <Notice tone="attention" icon={<AlertTriangle />}>
        {state.message}
      </Notice>
    );
  }

  return (
    <video
      // Keyed on the URL so a refreshed link remounts the element rather than
      // leaving the old, possibly expired, source attached.
      key={state.playback.url}
      controls
      preload="metadata"
      playsInline
      title={title}
      className="aspect-video w-full rounded-[var(--radius-lg)] border border-border bg-black"
    >
      <source src={state.playback.url} type={state.playback.mimeType} />
      Your browser cannot play this video format.
    </video>
  );
}
