"use client";

import { useCallback } from "react";

import { useOptionalAppStore } from "@/lib/store/app-store";
import type { VideoResource } from "@/types";

/**
 * ============================================================================
 * RESOLVING A RECOMMENDED VIDEO ID AGAINST THE LIBRARY THIS READER HAS
 * ============================================================================
 *
 * Three surfaces turn `recommendedVideoIds` into cards — the chat bubble, the
 * chat context panel and the Overview's answer sheet — and all three used
 * `videoById` from `data/demo/videos.ts`, which searches `DEMO_VIDEOS`.
 *
 * THAT WAS TWO PROBLEMS AT ONCE, and the second is a real defect rather than
 * a tidiness complaint:
 *
 *   IT SHIPPED THE SEEDED LIBRARY. An ES import is all-or-nothing, so three
 *   production components pulled the whole seeded video list into the client
 *   bundle to resolve an id.
 *
 *   AND IN LIVE MODE IT COULD NOT RESOLVE ANYTHING. The live library is
 *   `training_videos`, read through `GET /api/videos` into the store; the
 *   seeded list is a different set of ids entirely. So every id Claude
 *   recommended missed, got filtered out as `undefined`, and the
 *   recommendation silently never appeared. The feature looked like it was
 *   choosing not to suggest anything.
 *
 * So the lookup reads the STORE, which holds the live library in live mode and
 * the seeded one in demo mode. Both modes resolve against the library they
 * actually have, and neither ships the other's.
 */
export function useVideoLookup(): (id: string) => VideoResource | undefined {
  /*
   * OPTIONAL, so a component rendered outside the provider resolves nothing
   * instead of throwing. A missing recommendation card is a smaller failure
   * than a crashed conversation, and these three components are rendered in
   * isolation often enough that the strict accessor made them fragile.
   */
  const store = useOptionalAppStore();
  const videos = store?.videos;
  return useCallback(
    (id: string) => videos?.find((video) => video.id === id),
    [videos],
  );
}
