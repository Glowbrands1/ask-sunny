"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { DialogActions } from "@/components/ui/overlays";
import { VIDEO_CATEGORIES } from "@/lib/videos/categories";
import type { TrainingVideo, UpdateTrainingVideoRequest } from "@/lib/videos/types";
import type { VideoCategory } from "@/types";

/**
 * ============================================================================
 * EDITING A VIDEO'S METADATA — NO RE-UPLOAD
 * ============================================================================
 *
 * The whole point of this dialog is that changing a video's category does not
 * touch its bytes. It sends six fields to `PATCH /api/videos/:id` and the
 * object in the bucket is not involved at all.
 *
 * THE FORM CAN ONLY EXPRESS THE SIX EDITABLE FIELDS. There is no hidden input
 * for `status`, no `storagePath`, no transcript field — so nothing on this
 * screen can even attempt an edit the server would refuse. The server refuses
 * them anyway, by rebuilding its update from six named fields; this is the
 * matching half, not the enforcement.
 *
 * THE CATEGORY SELECT READS THE CANONICAL VOCABULARY, the same
 * `VIDEO_CATEGORIES` the upload dialog and the server validation use. A select
 * offering an option the server rejects is the drift this consolidation
 * removed.
 */
export function EditVideoDialog({
  video,
  onSaved,
  onCancel,
}: {
  video: TrainingVideo;
  onSaved: (updated: TrainingVideo) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = React.useState(video.title);
  const [description, setDescription] = React.useState(video.description);
  const [category, setCategory] = React.useState<VideoCategory>(
    video.category as VideoCategory,
  );
  // Joined for editing, split on save — the same comma convention the upload
  // dialog uses, so the two forms behave identically.
  const [equipment, setEquipment] = React.useState(video.equipment.join(", "));
  const [keywords, setKeywords] = React.useState(video.keywords.join(", "));
  const [tags, setTags] = React.useState(video.tags.join(", "));

  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const parseList = (value: string) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  async function save() {
    if (!title.trim()) return;
    setFailure(null);
    setSaving(true);

    const body: UpdateTrainingVideoRequest = {
      title: title.trim(),
      description: description.trim(),
      category,
      equipment: parseList(equipment),
      keywords: parseList(keywords),
      tags: parseList(tags),
    };

    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(video.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => null)) as
        | { video?: TrainingVideo; error?: string }
        | null;

      if (!response.ok || !payload?.video) {
        setFailure(
          // The server's own wording — it names a category vocabulary or a
          // length limit, never a database error.
          payload?.error ?? "The changes could not be saved. Nothing was changed.",
        );
        return;
      }

      /*
       * THE SERVER'S RECORD, not the local form state. The server normalises
       * (lower-cases keywords and tags, trims, drops over-long entries), so
       * handing back the form values would show the reader something slightly
       * different from what was stored.
       */
      onSaved(payload.video);
    } catch {
      setFailure("The changes did not reach the server. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldGroup label="Title" htmlFor="edit-video-title" className="sm:col-span-2">
          <Input id="edit-video-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </FieldGroup>

        <FieldGroup label="Description" htmlFor="edit-video-description" className="sm:col-span-2">
          <Textarea
            id="edit-video-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FieldGroup>

        <FieldGroup label="Category" htmlFor="edit-video-category">
          <Select
            id="edit-video-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as VideoCategory)}
          >
            {VIDEO_CATEGORIES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </Select>
        </FieldGroup>

        <FieldGroup label="Equipment" htmlFor="edit-video-equipment" hint="Comma separated">
          <Input
            id="edit-video-equipment"
            value={equipment}
            onChange={(event) => setEquipment(event.target.value)}
          />
        </FieldGroup>

        <FieldGroup label="Keywords" htmlFor="edit-video-keywords" hint="Comma separated">
          <Input id="edit-video-keywords" value={keywords} onChange={(event) => setKeywords(event.target.value)} />
        </FieldGroup>

        <FieldGroup label="Tags" htmlFor="edit-video-tags" hint="Comma separated">
          <Input id="edit-video-tags" value={tags} onChange={(event) => setTags(event.target.value)} />
        </FieldGroup>
      </div>

      <Notice tone="neutral" className="mt-4">
        Editing metadata does not touch the video file. The uploaded video and
        its playback are unaffected.
      </Notice>

      {failure ? (
        <Notice tone="attention" icon={<AlertTriangle />} className="mt-3">
          {failure}
        </Notice>
      ) : null}

      <DialogActions>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={saving || !title.trim()}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </DialogActions>
    </div>
  );
}
