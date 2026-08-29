"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Clock, History, Info, Search, Upload, Video as VideoIcon } from "lucide-react";

import { VideoCard, VideoThumbnail } from "@/components/video-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { DemoDataNote, EmptyState, Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, SectionHeader } from "@/components/ui/layout";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import {
  DEMO_VIDEO_ACTIVITY,
  VIDEO_CATEGORIES,
  VIDEO_CATEGORY_LABEL,
} from "@/data/demo/videos";
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import { formatDate, relativeTime } from "@/lib/utils/date";
import { formatDuration, formatNumber, pluralize } from "@/lib/utils/format";
import type { VideoCategory, VideoResource } from "@/types";
import { UploadVideoDialog } from "./upload-video-dialog";

const ACTIVITY_TONE = {
  added: "ready",
  updated: "processing",
  deleted: "failed",
} as const;

export function VideosScreen() {
  const searchParams = useSearchParams();
  const { can } = useSession();
  const { videos } = useAppStore();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<VideoCategory | "all">("all");
  const [uploadOpen, setUploadOpen] = useState(false);

  const canManage = can("manage_videos");

  // Deep link (?video=…) derived during render; `undefined` = no local override.
  const [activeOverride, setActiveOverride] = useState<string | null | undefined>();
  const activeId =
    activeOverride === undefined ? searchParams.get("video") : activeOverride;
  const setActiveId = (next: string | null) => setActiveOverride(next);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return videos
      .filter((video) => (category === "all" ? true : video.category === category))
      .filter((video) => {
        if (!q) return true;
        return (
          video.title.toLowerCase().includes(q) ||
          video.description.toLowerCase().includes(q) ||
          video.keywords.some((keyword) => keyword.includes(q)) ||
          video.tags.some((tag) => tag.includes(q)) ||
          video.equipment.some((item) => item.toLowerCase().includes(q))
        );
      })
      .sort(
        (a, b) =>
          new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
      );
  }, [videos, query, category]);

  const activeVideo = videos.find((video) => video.id === activeId) ?? null;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Knowledge"
        title="Training Videos"
        description="Short, practical training. Describe a problem in chat and the matching video surfaces alongside the answer."
        actions={
          canManage ? (
            <Button onClick={() => setUploadOpen(true)}>
              <Upload />
              Upload video
            </Button>
          ) : null
        }
      />

      {/* Filters */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="scroll-slim -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <FilterChip
            label="All"
            count={videos.length}
            active={category === "all"}
            onClick={() => setCategory("all")}
          />
          {VIDEO_CATEGORIES.map((entry) => (
            <FilterChip
              key={entry.id}
              label={entry.label}
              count={videos.filter((video) => video.category === entry.id).length}
              active={category === entry.id}
              onClick={() => setCategory(entry.id)}
            />
          ))}
        </div>

        <div className="relative shrink-0">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, keyword or equipment…"
            aria-label="Search videos"
            className="pl-9 lg:w-72"
          />
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          {formatNumber(filtered.length)} {pluralize(filtered.length, "video")}
          {category !== "all" ? ` in ${VIDEO_CATEGORY_LABEL[category]}` : ""}
        </p>
        <DemoDataNote />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<VideoIcon />}
          title="No videos match"
          description="Try a different search term or clear the category filter."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery("");
                setCategory("all");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              onOpen={(selected) => setActiveId(selected.id)}
            />
          ))}
        </div>
      )}

      {/* Recent activity */}
      <section className="mt-10">
        <SectionHeader
          title="Recent video activity"
          description="Who added, updated or removed training, and when."
        />
        <Card>
          <CardContent className="p-2">
            <ul className="divide-y divide-border">
              {DEMO_VIDEO_ACTIVITY.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-3 py-3">
                  <History
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <Badge tone={ACTIVITY_TONE[entry.action]} size="sm">
                    {entry.action}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {entry.videoTitle}
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {entry.actor}
                  </span>
                  <span className="shrink-0 text-xs text-subtle-foreground">
                    {relativeTime(entry.at)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      <Notice tone="neutral" icon={<Info />} className="mt-6">
        Video files live locally in this prototype. Cloud storage, playback and
        transcription arrive later — transcription is what will let Sunny answer
        from what is said inside a video, not only from its metadata.
      </Notice>

      {/* Detail */}
      <Dialog
        open={Boolean(activeVideo)}
        onOpenChange={(open) => {
          if (!open) setActiveId(null);
        }}
      >
        {activeVideo ? (
          <DialogContent title={activeVideo.title} wide>
            <VideoDetail video={activeVideo} />
          </DialogContent>
        ) : null}
      </Dialog>

      {/* Upload */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent
          title="Add a training video"
          description="Record the metadata that powers chat recommendations. Optionally attach a local file."
          wide
        >
          <UploadVideoDialog onDone={() => setUploadOpen(false)} />
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "border-primary bg-primary-soft text-primary-soft-foreground"
          : "border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground",
      )}
    >
      {label}
      <span className="text-[11px] tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function VideoDetail({ video }: { video: VideoResource }) {
  return (
    <div>
      <VideoThumbnail video={video} className="aspect-[16/7] w-full" />

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{VIDEO_CATEGORY_LABEL[video.category]}</Badge>
        <Badge tone="outline">
          <Clock className="size-2.5" aria-hidden />
          {formatDuration(video.durationSeconds)}
        </Badge>
        <Badge tone="neutral">
          Transcript: {video.transcriptStatus.replace(/_/g, " ")}
        </Badge>
      </div>

      <p className="mt-3.5 text-[13px] leading-relaxed text-muted-foreground">
        {video.description}
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-5 sm:grid-cols-3">
        {[
          { label: "Uploaded by", value: video.uploadedBy },
          { label: "Added", value: formatDate(video.uploadedAt) },
          { label: "Views", value: formatNumber(video.viewCount) },
        ].map((entry) => (
          <div key={entry.label}>
            <dt className="eyebrow">{entry.label}</dt>
            <dd className="mt-1 text-[13px] text-foreground">{entry.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 space-y-4 border-t border-border pt-5">
        <p className="text-[13px] font-semibold text-foreground">
          What Sunny matches on
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          These four fields drive video recommendations in chat — a manager
          describes the problem in plain language and the matching video surfaces
          with the answer.
        </p>

        {[
          { label: "Equipment", values: video.equipment },
          { label: "Keywords", values: video.keywords },
          { label: "Tags", values: video.tags },
        ].map((group) => (
          <div key={group.label}>
            <p className="eyebrow mb-1.5">{group.label}</p>
            {group.values.length === 0 ? (
              <p className="text-xs text-subtle-foreground">None</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {group.values.map((value) => (
                  <Badge key={value} tone="neutral" size="sm">
                    {value}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <Notice tone="neutral" icon={<Info />} className="mt-5">
        Playback is not part of this phase. Cloud video storage and transcription
        are on the roadmap.
      </Notice>
    </div>
  );
}
