"use client";

import { useRef, useState } from "react";
import { FileUp, Info, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { DialogActions } from "@/components/ui/overlays";
import { VIDEO_CATEGORIES } from "@/data/demo/videos";
import { useSession } from "@/lib/session/session-context";
import { getStorageProvider } from "@/lib/storage";
import { useAppStore } from "@/lib/store/app-store";
import { nowIso } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import { formatBytes } from "@/lib/utils/format";
import { createId } from "@/lib/utils/id";
import type { VideoCategory, VideoResource } from "@/types";

const TONES: VideoResource["thumbnailTone"][] = [
  "sage",
  "tan",
  "blush",
  "slate",
  "gold",
];

/**
 * Adds a video to the library.
 *
 * Metadata is persisted like documents. A local file may be attached and is
 * stored in IndexedDB, but there is no playback, no transcoding and no
 * transcription in this phase — all three are explicitly future work.
 */
export function UploadVideoDialog({ onDone }: { onDone: () => void }) {
  const { user } = useSession();
  const { addVideo } = useAppStore();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<VideoCategory>("training");
  const [duration, setDuration] = useState("3");
  const [equipment, setEquipment] = useState("");
  const [keywords, setKeywords] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  const parseList = (value: string) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);

    const id = createId("vid");
    if (file) {
      await getStorageProvider().putBlob(`video-${id}`, file, {
        fileName: file.name,
        mimeType: file.type || "video/mp4",
        sizeBytes: file.size,
        createdAt: nowIso(),
      });
    }

    const video: VideoResource = {
      id,
      title: title.trim(),
      description: description.trim() || "Added through the Ask Sunny video library.",
      category,
      durationSeconds: Math.max(30, Math.round(Number(duration) * 60) || 180),
      uploadedBy: user.name,
      uploadedAt: nowIso(),
      equipment: parseList(equipment),
      keywords: parseList(keywords).map((entry) => entry.toLowerCase()),
      tags: parseList(tags).map((entry) => entry.toLowerCase()),
      transcriptStatus: "not_started",
      thumbnailTone: TONES[Math.floor(Math.random() * TONES.length)],
      viewCount: 0,
    };

    addVideo(video);
    setSaving(false);
    onDone();
  };

  return (
    <div>
      <div
        className={cn(
          "rounded-[var(--radius-lg)] border-2 border-dashed border-border-strong bg-surface-muted p-5 text-center",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="sr-only"
          id="video-file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface text-primary">
              <FileUp className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 text-left">
              <span className="block truncate text-[13px] font-medium text-foreground">
                {file.name}
              </span>
              <span className="block text-xs text-muted-foreground">
                {formatBytes(file.size)}
              </span>
            </span>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Remove selected file"
              onClick={() => setFile(null)}
            >
              <X />
            </Button>
          </div>
        ) : (
          <>
            <p className="text-[13px] font-medium text-foreground">
              Attach a local video file (optional)
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2.5"
              onClick={() => inputRef.current?.click()}
            >
              Choose a file
            </Button>
            <p className="mt-2.5 text-xs text-muted-foreground">
              Metadata alone is enough to add the video to the library.
            </p>
          </>
        )}
      </div>

      <div className="mt-5 space-y-4">
        <FieldGroup label="Title" htmlFor="video-title" required>
          <Input
            id="video-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Handling the Price Objection"
          />
        </FieldGroup>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FieldGroup label="Category" htmlFor="video-category" required>
            <Select
              id="video-category"
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

          <FieldGroup label="Duration (minutes)" htmlFor="video-duration">
            <Input
              id="video-duration"
              type="number"
              min={1}
              max={90}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </FieldGroup>
        </div>

        <FieldGroup label="Description" htmlFor="video-description">
          <Textarea
            id="video-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-20"
            placeholder="What does this video teach?"
          />
        </FieldGroup>

        <FieldGroup
          label="Equipment"
          htmlFor="video-equipment"
          hint="Comma separated. Leave blank if the video is not equipment specific."
        >
          <Input
            id="video-equipment"
            value={equipment}
            onChange={(event) => setEquipment(event.target.value)}
            placeholder="Spray booth, Level 3 bed"
          />
        </FieldGroup>

        <FieldGroup
          label="Keywords"
          htmlFor="video-keywords"
          hint="How a manager would describe the problem out loud. This is what chat matches on."
        >
          <Input
            id="video-keywords"
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
            placeholder="objection, price, membership, conversion"
          />
        </FieldGroup>

        <FieldGroup label="Tags" htmlFor="video-tags">
          <Input
            id="video-tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="sales, objections"
          />
        </FieldGroup>
      </div>

      <Notice tone="neutral" icon={<Info />} className="mt-5">
        Equipment, keywords, tags and category are the four fields chat matches
        against — the same fields the reference platform uses. Fill them
        properly and recommendations work well without anyone knowing a video
        title.
      </Notice>

      <DialogActions>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={() => void handleSubmit()} disabled={!title.trim() || saving}>
          {saving ? "Adding…" : "Add video"}
        </Button>
      </DialogActions>
    </div>
  );
}
