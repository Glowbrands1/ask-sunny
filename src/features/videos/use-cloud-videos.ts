"use client";

import * as React from "react";

import { isDemoMode } from "@/lib/config/runtime";
import type { TrainingVideo } from "@/lib/videos/types";

/**
 * THE LIVE VIDEO LIBRARY, READ FROM THE SERVER.
 *
 * `GET /api/videos` reads `training_videos` under the secret key after checking
 * `view_videos`. That is the canonical library in live mode — not
 * `useAppStore().videos`, which is IndexedDB and therefore per-browser.
 *
 * NOTHING IS WRITTEN BACK TO INDEXEDDB. Caching cloud records there would
 * recreate the problem this milestone exists to remove: a library that differs
 * per browser and survives a deleted row. The fetch runs on mount and after an
 * upload, and a reload re-reads the server.
 *
 * IN DEMO MODE THIS DOES NOTHING AT ALL. There is no Supabase to read and no
 * `training_videos` table, so it reports `disabled` and the screen shows the
 * seeded library instead. The two sources are never merged into one array.
 */
export type CloudVideosState =
  /** Demo mode: there is no cloud library to load. */
  | { status: "disabled" }
  | { status: "loading" }
  | { status: "ready"; videos: TrainingVideo[] }
  | { status: "error"; message: string };

export function useCloudVideos(): {
  state: CloudVideosState;
  refresh: () => void;
} {
  const live = !isDemoMode();
  const [state, setState] = React.useState<CloudVideosState>(
    live ? { status: "loading" } : { status: "disabled" },
  );
  /**
   * Bumped to re-run the fetch after an upload.
   *
   * A token rather than an exported async loader: the fetch lives inside the
   * effect, with a cancellation flag, so a response that arrives after the
   * screen unmounts cannot set state on a gone component.
   */
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    if (!live) return;

    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/videos");
        const payload = (await response.json().catch(() => null)) as
          | { videos?: TrainingVideo[]; error?: string }
          | null;

        if (cancelled) return;

        if (!response.ok || !Array.isArray(payload?.videos)) {
          setState({
            status: "error",
            // The server's own wording. Its handlers never name a storage path
            // or a database error.
            message: payload?.error ?? "The video library could not be loaded.",
          });
          return;
        }

        setState({ status: "ready", videos: payload.videos });
      } catch {
        if (cancelled) return;
        setState({
          status: "error",
          message: "The video library could not be reached. Check your connection.",
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [live, reloadToken]);

  const refresh = React.useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { state, refresh };
}
