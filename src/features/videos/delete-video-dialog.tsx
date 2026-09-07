"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { DialogActions } from "@/components/ui/overlays";
import type { TrainingVideo } from "@/lib/videos/types";

/**
 * ============================================================================
 * DELETION IS NEVER ONE CLICK
 * ============================================================================
 *
 * A training video is somebody's recording, and removing it takes the file with
 * it. So the confirmation NAMES THE VIDEO rather than asking "are you sure?" —
 * a generic prompt on a grid of cards is exactly how the wrong one goes.
 *
 * IT ALSO SAYS WHAT DELETION MEANS: gone from the library for everyone, and the
 * stored file removed. That is worth stating plainly, because "delete" in a
 * prototype often meant "hide", and a manager who expected an archive would be
 * surprised.
 *
 * A PARTIAL FAILURE IS REPORTED HONESTLY. If the row goes and the stored file
 * does not, the server says so and the video really is gone from the product —
 * this dialog passes that warning up rather than turning it into a failure that
 * would imply the video survived.
 */
export function DeleteVideoDialog({
  video,
  onDeleted,
  onCancel,
}: {
  video: Pick<TrainingVideo, "id" | "title" | "status">;
  /** `warning` is set when the row went but the stored file did not. */
  onDeleted: (result: { warning: string | null }) => void;
  onCancel: () => void;
}) {
  const [deleting, setDeleting] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  async function confirm() {
    setFailure(null);
    setDeleting(true);

    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(video.id)}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => null)) as
        | { deleted?: boolean; storageCleaned?: boolean; warning?: string; error?: string }
        | null;

      if (!response.ok || payload?.deleted !== true) {
        /*
         * NOT DELETED, AND NOT CLAIMED AS DELETED. The dialog stays open with
         * the reason, so nobody walks away believing a video is gone when the
         * row is still there.
         */
        setFailure(payload?.error ?? "The video could not be deleted. Nothing was removed.");
        return;
      }

      onDeleted({ warning: payload.warning ?? null });
    } catch {
      setFailure("The request did not reach the server. Nothing was removed.");
    } finally {
      setDeleting(false);
    }
  }

  const neverUploaded = video.status !== "ready";

  return (
    <div>
      <p className="text-[13px] leading-relaxed text-foreground">
        Delete <span className="font-semibold">“{video.title}”</span>?
      </p>

      <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
        {neverUploaded ? (
          <>
            This upload never completed, so there is no playable file. The record
            will be removed from the Ask Sunny training library, along with any
            partial file in storage.
          </>
        ) : (
          <>
            This removes the video from the Ask Sunny training library for
            everyone, and deletes the stored video file. It cannot be undone —
            the video would have to be uploaded again.
          </>
        )}
      </p>

      {failure ? (
        <Notice tone="attention" icon={<AlertTriangle />} className="mt-3">
          {failure}
        </Notice>
      ) : null}

      <DialogActions>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={() => void confirm()} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete video"}
        </Button>
      </DialogActions>
    </div>
  );
}
