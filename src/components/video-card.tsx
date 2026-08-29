import Link from "next/link";
import { Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { VIDEO_CATEGORY_LABEL } from "@/data/demo/videos";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/date";
import { formatDuration } from "@/lib/utils/format";
import type { VideoResource } from "@/types";

const TONE_CLASS: Record<VideoResource["thumbnailTone"], string> = {
  sage: "bg-accent-soft text-accent-soft-foreground",
  tan: "bg-primary-soft text-primary-soft-foreground",
  blush: "bg-blush-soft text-blush-soft-foreground",
  slate: "bg-status-processing-bg text-status-processing",
  gold: "bg-gold-soft text-gold-deep",
};

/** Placeholder thumbnail — geometric, no stock imagery, no cartoon. */
export function VideoThumbnail({
  video,
  className,
}: {
  video: VideoResource;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-[var(--radius-md)]",
        TONE_CLASS[video.thumbnailTone],
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 120 68" className="absolute inset-0 size-full opacity-35">
        <circle cx="98" cy="14" r="26" fill="currentColor" opacity="0.28" />
        <circle cx="18" cy="58" r="18" fill="currentColor" opacity="0.2" />
      </svg>
      <span className="relative flex size-9 items-center justify-center rounded-full bg-surface/85 shadow-soft">
        <Play className="size-3.5 translate-x-px fill-current" />
      </span>
    </div>
  );
}

export function VideoCard({
  video,
  onOpen,
  className,
}: {
  video: VideoResource;
  onOpen?: (video: VideoResource) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(video)}
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface text-left shadow-soft transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-raised",
        className,
      )}
    >
      <div className="relative p-2.5 pb-0">
        <VideoThumbnail video={video} className="aspect-[16/9] w-full" />
        <span className="absolute right-4 bottom-2 rounded-full bg-[color-mix(in_srgb,var(--foreground)_78%,transparent)] px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
          {formatDuration(video.durationSeconds)}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <Badge tone="neutral" size="sm" className="self-start">
          {VIDEO_CATEGORY_LABEL[video.category]}
        </Badge>
        <p className="mt-2.5 text-[14px] leading-snug font-semibold text-foreground group-hover:text-primary">
          {video.title}
        </p>
        <p className="mt-1.5 line-clamp-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
          {video.description}
        </p>
        <p className="mt-3 text-xs text-subtle-foreground">
          {video.uploadedBy} · {formatDate(video.uploadedAt)}
        </p>
      </div>
    </button>
  );
}

/** Compact card used inside chat answers. */
export function VideoSuggestionCard({
  video,
  className,
}: {
  video: VideoResource;
  className?: string;
}) {
  return (
    <Link
      href={`/videos?video=${video.id}`}
      className={cn(
        "group flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-2.5 shadow-soft transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-raised",
        className,
      )}
    >
      <VideoThumbnail video={video} className="h-12 w-20 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground group-hover:text-primary">
          {video.title}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {formatDuration(video.durationSeconds)} ·{" "}
          {VIDEO_CATEGORY_LABEL[video.category]}
        </span>
      </span>
    </Link>
  );
}
