"use client";

import { Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/layout";
import type { TrainingVideo } from "@/lib/videos/types";

/**
 * ============================================================================
 * UPLOADS NEEDING ATTENTION — ADMIN ONLY, AND NEVER CALLED "LEGACY"
 * ============================================================================
 *
 * A pending or failed row is a cloud record this deployment created, not a
 * pre-cloud browser-local file. It used to land in the ordinary library and
 * pick up the legacy wording, which was false about a row created seconds
 * earlier. These are separated, labelled by their real status, and only reach a
 * caller the server judged may see them.
 *
 * ============================================================================
 * A STUCK ROW HAS TO BE CLEARABLE, NOT MERELY VISIBLE
 * ============================================================================
 *
 * THE QA FINDING THIS CLOSES. The section rendered a title, a sentence and a
 * badge, and stopped there. `DELETE /api/videos/:id` has always accepted a
 * `pending_upload` or `failed` row, and `DeleteVideoDialog` has always carried
 * the wording for one — but nothing on the page could reach either. An
 * administrator could see a dead upload and had no way to remove it, which is a
 * worse state than not showing it at all: the section exists to be acted on.
 *
 * SO EACH ROW OFFERS THE SAME NAMED CONFIRMATION THE LIBRARY CARDS DO. Not a
 * second, quieter delete path — `onDelete` hands the id back to the screen,
 * which opens the one `DeleteVideoDialog` every other delete goes through, so a
 * dead upload is removed by the same confirmed, refetching flow as a real
 * video. Deleting straight from the row would be one click on a destructive
 * action, and this list is exactly where the wrong row gets clicked.
 *
 * THE PERMISSION IS NOT CHECKED HERE. `videos` is `needsAttention` from
 * `GET /api/videos`, which the server populates only for a caller holding
 * `manage_videos` — a viewer receives an empty array and this section never
 * renders. Re-checking in the browser would suggest the browser is what decides.
 *
 * THE BUTTON NAMES THE VIDEO. A column of identical "Delete" controls is
 * unusable with a screen reader, and this is the list where every row looks
 * alike.
 */
export function UploadsNeedingAttention({
  videos,
  onDelete,
}: {
  /** Pending and failed rows, exactly as the server sent them. */
  videos: TrainingVideo[];
  /** Opens the shared delete confirmation for this id. Never deletes here. */
  onDelete: (id: string) => void;
}) {
  if (videos.length === 0) return null;

  return (
    <section className="mt-6 space-y-3">
      <SectionHeader
        title="Uploads needing attention"
        description="These records exist in the library but have no playable file. They are not visible to viewers."
      />
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {videos.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <div>
                <p className="text-[13px] font-medium text-foreground">
                  {entry.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {entry.status === "pending_upload"
                    ? "Upload has not been completed."
                    : "Upload failed. Re-upload this video."}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={entry.status === "failed" ? "outline" : "neutral"} size="sm">
                  {entry.status === "pending_upload" ? "Pending upload" : "Upload failed"}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${entry.title}`}
                  onClick={() => onDelete(entry.id)}
                >
                  <Trash2 aria-hidden />
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
