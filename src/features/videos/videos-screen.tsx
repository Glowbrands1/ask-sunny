"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Clock, History, Info, MoreVertical, Pencil, Search, Trash2, Upload, Video as VideoIcon } from "lucide-react";

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
import { isDemoMode } from "@/lib/config/runtime";
import { useCloudVideos } from "./use-cloud-videos";
import { cn } from "@/lib/utils/cn";
import { formatDate, relativeTime } from "@/lib/utils/date";
import { formatDuration, formatNumber, pluralize } from "@/lib/utils/format";
import type { VideoCategory, VideoResource } from "@/types";
import { UploadVideoDialog } from "./upload-video-dialog";
import { VideoPlayer } from "./video-player";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { VideoTranscript } from "./video-transcript";
import { VideoPreview } from "./video-preview";
import { EditVideoDialog } from "./edit-video-dialog";
import { DeleteVideoDialog } from "./delete-video-dialog";
import { CategoryOverview } from "./category-overview";
import type { TrainingVideo } from "@/lib/videos/types";

const ACTIVITY_TONE = {
  added: "ready",
  updated: "processing",
  deleted: "failed",
} as const;

/**
 * ============================================================================
 * WHERE THE LIBRARY COMES FROM
 * ============================================================================
 *
 * LIVE: `GET /api/videos`, which reads `training_videos` under the secret key
 * after checking `view_videos`. That is canonical — it survives a reload, it is
 * the same in every browser, and it is what a colleague sees.
 *
 * DEMO: `useAppStore().videos`, the seeded prototype library in IndexedDB.
 *
 * THE TWO ARE NEVER MERGED INTO ONE ARRAY. They differ in the one way that
 * matters to somebody trying to watch something — whether a file exists
 * anywhere but the uploader's own browser — so in live mode any surviving
 * prototype record is shown in its own clearly-labelled section rather than
 * sitting indistinguishably beside a cloud video.
 *
 * Cloud records are NOT written back into IndexedDB. Caching them there would
 * recreate the per-browser library this milestone exists to remove.
 */
export function VideosScreen() {
  const searchParams = useSearchParams();
  const { can } = useSession();
  const { videos: localVideos } = useAppStore();
  const live = !isDemoMode();
  const { state: cloudState, refresh: refreshCloud } = useCloudVideos();

  /*
   * Cloud records, adapted to the shape the cards and filters already use.
   * `hasCloudAsset` is carried through so the detail view can tell the two
   * kinds apart without another lookup.
   */
  const cloudVideos: VideoResource[] = useMemo(
    () => (cloudState.status === "ready" ? cloudState.videos.map(toResource) : []),
    [cloudState],
  );

  /**
   * THE CANONICAL LIST FOR THIS MODE. In live mode a prototype record is not
   * part of the library — it appears below, labelled, and never in the counts,
   * the filters or the deep-link lookup that promise a playable video.
   */
  const videos = live ? cloudVideos : localVideos;
  /**
   * Uploads that never completed. Empty unless the caller holds `manage_videos`
   * — the server decides that, not this component.
   */
  const needsAttention =
    cloudState.status === "ready" ? cloudState.needsAttention : [];


  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<VideoCategory | "all">("all");
  const [uploadOpen, setUploadOpen] = useState(false);

  /** Which video an admin dialog is open for. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** Set when a delete removed the row but not the stored file. */
  const [cleanupWarning, setCleanupWarning] = useState<string | null>(null);

  /**
   * COUNTS OVER THE WHOLE LIBRARY, NOT THE FILTERED VIEW.
   *
   * The overview answers "what does this library contain", so it must not
   * change when a category is selected — a tile reading "0 videos" because a
   * different category is filtered would be actively misleading. Search DOES
   * narrow it, because then the question is "what did my search find, and
   * where", and a truthful count is the whole point of the section headings
   * below.
   */
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return videos;
    return videos.filter(
      (video) =>
        video.title.toLowerCase().includes(q) ||
        video.description.toLowerCase().includes(q) ||
        video.keywords.some((keyword) => keyword.includes(q)) ||
        video.tags.some((tag) => tag.includes(q)) ||
        video.equipment.some((item) => item.toLowerCase().includes(q)),
    );
  }, [videos, query]);

  const counts = useMemo(() => {
    const tally: Partial<Record<VideoCategory, number>> = {};
    for (const video of searched) {
      tally[video.category] = (tally[video.category] ?? 0) + 1;
    }
    return tally;
  }, [searched]);

  /**
   * The visible sections, in canonical category order.
   *
   * A category with no matching videos is omitted HERE and still shown in the
   * overview above — seven empty headings would be a screenful of nothing,
   * while a zero in the overview is one line of real information. When a
   * specific category is filtered it gets a section even when empty, so the
   * reader sees an honest "nothing here" rather than a blank page.
   */
  const sections = useMemo(() => {
    const wanted =
      category === "all" ? VIDEO_CATEGORIES.map((entry) => entry.id) : [category];

    return wanted
      .map((id) => ({
        id,
        label: VIDEO_CATEGORY_LABEL[id],
        videos: searched
          .filter((video) => video.category === id)
          .sort(
            (a, b) =>
              new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
          ),
      }))
      .filter((section) => category !== "all" || section.videos.length > 0);
  }, [searched, category]);

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

  /**
   * The SERVER'S record for an id, looked up across both lists.
   *
   * The admin list matters here: a pending or failed upload is not in the
   * library, and an administrator still has to be able to delete it. Resolving
   * from `cloudState` rather than from the card means the dialogs always act on
   * what the server last said, never on a stale view-model.
   */
  const cloudRecord = (id: string | null) => {
    if (id === null || cloudState.status !== "ready") return null;
    return (
      cloudState.videos.find((entry) => entry.id === id) ??
      cloudState.needsAttention.find((entry) => entry.id === id) ??
      null
    );
  };

  const editing = cloudRecord(editingId);
  const deleting = cloudRecord(deletingId);

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
          {live && cloudState.status === "loading"
            ? "Loading the video library…"
            : `${formatNumber(filtered.length)} ${pluralize(filtered.length, "video")}`}
          {category !== "all" ? ` in ${VIDEO_CATEGORY_LABEL[category]}` : ""}
        </p>
        {/*
          DEMO MODE ONLY. It read "Demo content — seeded for this prototype,
          not real company data" on a page showing a real Supabase video, which
          was simply false.
        */}
        {live ? null : <DemoDataNote />}
      </div>

      {/* The library's shape, including the categories that are empty. */}
      <CategoryOverview counts={counts} active={category} onSelect={setCategory} />

      {searched.length === 0 ? (
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
        <div className="space-y-8">
          {sections.map((section) => (
            <section key={section.id} className="space-y-3">
              <SectionHeader
                title={section.label}
                description={`${formatNumber(section.videos.length)} ${pluralize(
                  section.videos.length,
                  "video",
                )}`}
              />
              {section.videos.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  No videos in this category yet.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {section.videos.map((video) => (
                    <VideoCard
                      key={video.id}
                      video={video}
                      onOpen={(selected) => setActiveId(selected.id)}
                      /*
                       * A REAL FRAME, only for a cloud video. A demo or legacy
                       * record has no object to sign, so it keeps the
                       * placeholder rather than showing a failed preview.
                       */
                      preview={
                        live && video.hasCloudAsset === true ? (
                          <VideoPreview
                            videoId={video.id}
                            className="aspect-[16/9] w-full"
                            fallback={
                              <VideoThumbnail video={video} className="aspect-[16/9] w-full" />
                            }
                          />
                        ) : undefined
                      }
                      /*
                       * Edit and delete only for a manager, and only for a
                       * cloud record — a demo video has no server row to
                       * change.
                       */
                      actions={
                        canManage && live && video.hasCloudAsset === true ? (
                          <VideoCardActions
                            title={video.title}
                            onEdit={() => setEditingId(video.id)}
                            onDelete={() => setDeletingId(video.id)}
                          />
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {cleanupWarning ? (
        <Notice tone="attention" icon={<Info />} className="mt-6">
          {cleanupWarning}
        </Notice>
      ) : null}

      {live && cloudState.status === "error" ? (
        <Notice tone="attention" icon={<Info />} className="mt-6">
          {cloudState.message} Nothing shown above is missing — the library
          could not be read at all, so this is not an empty library.
        </Notice>
      ) : null}

      {/*
        ============================================================================
        UPLOADS NEEDING ATTENTION — ADMIN ONLY, AND NEVER CALLED "LEGACY"
        ============================================================================

        A pending or failed row is a cloud record this deployment created, not a
        pre-cloud browser-local file. It used to land in the ordinary library
        and pick up the legacy wording, which was false about a row created
        seconds earlier. These are separated, labelled by their real status, and
        only reach a caller the server judged may see them.
      */}
      {needsAttention.length > 0 ? (
        <section className="mt-6 space-y-3">
          <SectionHeader
            title="Uploads needing attention"
            description="These records exist in the library but have no playable file. They are not visible to viewers."
          />
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {needsAttention.map((entry) => (
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
                  <Badge tone={entry.status === "failed" ? "outline" : "neutral"} size="sm">
                    {entry.status === "pending_upload" ? "Pending upload" : "Upload failed"}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {/*
        ============================================================================
        RECENT ACTIVITY IS DEMO CONTENT, SO IT IS DEMO-ONLY
        ============================================================================

        This rendered DEMO_VIDEO_ACTIVITY in live mode — invented names doing
        invented things to a real library. Hidden rather than replaced: there is
        no activity log for `training_videos`, and inventing live-looking rows
        from what the client happens to know would be the same lie in a new
        costume. A real audit log is its own milestone.
      */}
      {live ? null : (
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
      )}

      {live ? null : (
        <Notice tone="neutral" icon={<Info />} className="mt-6">
          Demo mode. This library is seeded content held in this browser —
          uploads here are local and are not published to cloud storage.
        </Notice>
      )}

      {/* Detail */}
      <Dialog
        open={Boolean(activeVideo)}
        onOpenChange={(open) => {
          if (!open) setActiveId(null);
        }}
      >
        {activeVideo ? (
          <DialogContent title={activeVideo.title} wide>
            <VideoDetail
              video={activeVideo}
              onEdit={canManage ? () => setEditingId(activeVideo.id) : undefined}
              onDelete={canManage ? () => setDeletingId(activeVideo.id) : undefined}
              /*
               * THE SERVER'S OWN RECORD, not one reconstructed from a
               * prototype resource. Status, MIME type, size and transcript
               * provider are facts the server knows and a legacy record simply
               * does not have — inventing them would put fabricated metadata
               * under a real video.
               */
              cloud={
                cloudState.status === "ready"
                  ? (cloudState.videos.find((entry) => entry.id === activeVideo.id) ?? null)
                  : null
              }
              canManage={canManage}
            />
          </DialogContent>
        ) : null}
      </Dialog>

      {/* Edit — metadata only. The video file is never involved. */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditingId(null);
        }}
      >
        {editing ? (
          <DialogContent
            title={`Edit “${editing.title}”`}
            description="Change the metadata that powers search and chat recommendations. The video file is not re-uploaded."
            wide
          >
            <EditVideoDialog
              video={editing}
              onCancel={() => setEditingId(null)}
              onSaved={() => {
                setEditingId(null);
                /*
                 * REFETCH RATHER THAN PATCH LOCAL STATE. The server normalises
                 * what it stored, and a category change has to move the card
                 * between sections and change two counts — re-reading the
                 * library is both simpler and guaranteed to match what a
                 * refresh would show.
                 */
                refreshCloud();
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>

      {/* Delete — named, confirmed, never one click. */}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
      >
        {deleting ? (
          <DialogContent title="Delete video" description="This cannot be undone.">
            <DeleteVideoDialog
              video={deleting}
              onCancel={() => setDeletingId(null)}
              onDeleted={({ warning }) => {
                setDeletingId(null);
                // Close the detail modal too if it was showing this video.
                if (activeId === deleting.id) setActiveId(null);
                setCleanupWarning(warning);
                refreshCloud();
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>

      {/* Upload */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent
          title="Add a training video"
          /*
            THE PARENT DIALOG SAID "Optionally attach a local file" while live
            mode disabled submit without one. Telling somebody a field is
            optional and then refusing the form is worse than saying nothing.
          */
          description={
            live
              ? "Choose the video file and record the metadata that powers chat recommendations."
              : "Record the metadata that powers chat recommendations. Optionally attach a local file."
          }
          wide
        >
          <UploadVideoDialog
            onDone={() => {
              setUploadOpen(false);
              // Only reached after the server CONFIRMED the object exists, so
              // the refetch is guaranteed to find the new row.
              refreshCloud();
            }}
          />
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

function VideoDetail({
  video,
  cloud,
  canManage,
  onEdit,
  onDelete,
}: {
  video: VideoResource;
  /** The server's record, when this is a cloud video. Null for a legacy one. */
  cloud: TrainingVideo | null;
  canManage: boolean;
  /** Provided only for a manager. Absent means the action is not offered. */
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  /*
   * A CLOUD ASSET IS THE ONLY THING THAT MAKES A VIDEO PLAYABLE.
   *
   * `hasCloudAsset` is set by the server from the row's status and storage
   * path. A prototype-era record has neither — its bytes went into the
   * uploader's own IndexedDB, which no other browser and no other device can
   * read — so it gets a truthful notice rather than a player that would spin
   * and fail. Pretending otherwise would be worse than the roadmap notice it
   * replaces: at least that one did not imply a file was there.
   */
  const playable = cloud?.hasCloudAsset === true;

  return (
    <div>
      {playable ? (
        <VideoPlayer videoId={video.id} title={video.title} />
      ) : (
        <VideoThumbnail video={video} className="aspect-[16/7] w-full" />
      )}

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

      {/*
        EDIT AND DELETE, only where the handlers were supplied — which the
        screen does only for a `manage_videos` holder on a cloud record. A
        viewer sees no buttons, and the APIs refuse them regardless.
      */}
      {canManage && cloud && (onEdit || onDelete) ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {onEdit ? (
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <Pencil aria-hidden />
              Edit details
            </Button>
          ) : null}
          {onDelete ? (
            <Button variant="destructive" size="sm" onClick={onDelete}>
              <Trash2 aria-hidden />
              Delete video
            </Button>
          ) : null}
        </div>
      ) : null}

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-5 sm:grid-cols-3">
        {[
          { label: "Uploaded by", value: video.uploadedBy },
          { label: "Added", value: formatDate(video.uploadedAt) },
          /*
           * NO "Views" STAT FOR A CLOUD VIDEO, and that is a finding rather
           * than an omission. `view_count` exists on the row and is displayed
           * nowhere that could move it: there is no increment anywhere in the
           * codebase, so a cloud record would read "0 views" forever while a
           * seeded demo record showed a number somebody wrote by hand. A
           * counter that never counts is worse than no counter.
           *
           * An atomic increment needs `view_count = view_count + 1`, which the
           * Supabase client cannot express in `.update()` — it wants a small
           * SQL function, and adding one means changing a migration that is
           * currently under review. So the display is withheld until the write
           * path exists rather than shipped as a number that means nothing.
           */
          ...(cloud
            ? []
            : [{ label: "Views", value: formatNumber(video.viewCount) }]),
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

      {/*
        THE REAL RECORD WHEN THERE IS ONE. A legacy resource is adapted only to
        say what it truthfully is — pending, with no file, no MIME type and no
        transcript — and nothing about it is invented.
      */}
      <VideoTranscript video={cloud ?? legacyViewOf(video)} canManage={canManage} />

      {/*
        FOUR DIFFERENT SITUATIONS, FOUR DIFFERENT SENTENCES.

        This used to be one paragraph — "added before cloud video storage
        existed, its file is still only in the browser" — shown for any record
        without a playable file. That is true of a prototype record and FALSE of
        a cloud row this deployment created minutes ago, which is exactly what a
        pending or failed upload is.
      */}
      {playable ? null : (
        <Notice tone="neutral" icon={<Info />} className="mt-5">
          {cloud === null ? (
            <>
              This record was created before cloud video storage and has no cloud
              asset, so it cannot be played here or anywhere else. Re-upload the
              file to publish it.
            </>
          ) : cloud.status === "pending_upload" ? (
            <>Upload has not been completed, so there is no file to play yet.</>
          ) : (
            <>Upload failed, so there is no file to play. Re-upload this video.</>
          )}
        </Notice>
      )}
    </div>
  );
}

/**
 * A CLOUD RECORD, in the shape the existing cards and filters read.
 *
 * The adaptation runs in this direction only — server record to view model —
 * because the server's record is the one with the facts. `hasCloudAsset` rides
 * along so the detail view can tell a published video from a legacy one.
 */
function toResource(video: TrainingVideo): VideoResource {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    category: video.category as VideoCategory,
    durationSeconds: video.durationSeconds,
    uploadedBy: video.uploadedByName,
    uploadedAt: video.uploadedAt,
    equipment: video.equipment,
    keywords: video.keywords,
    tags: video.tags,
    transcriptStatus: video.transcriptStatus as VideoResource["transcriptStatus"],
    thumbnailTone: video.thumbnailTone,
    viewCount: video.viewCount,
    hasCloudAsset: video.hasCloudAsset,
    transcriptText: video.transcriptText,
    transcriptErrorSafe: video.transcriptErrorSafe,
  };
}

/**
 * A LEGACY PROTOTYPE RECORD, described as exactly what it is.
 *
 * THIS USED TO FABRICATE A CLOUD RECORD. The previous adapter mapped any
 * `VideoResource` into a `TrainingVideo`, inventing `status: "ready"` whenever
 * a flag happened to be set and supplying `mimeType`, `sizeBytes` and
 * `transcriptProvider` as nulls that read like facts. A cloud video now brings
 * its own record from the server and never passes through here; this function
 * exists only for records that have no server row at all, and it states their
 * real condition: pending, no file, nothing transcribed.
 */
function legacyViewOf(video: VideoResource): TrainingVideo {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    category: video.category,
    durationSeconds: video.durationSeconds,
    uploadedByName: video.uploadedBy,
    uploadedAt: video.uploadedAt,
    equipment: video.equipment,
    keywords: video.keywords,
    tags: video.tags,
    // Never `ready`. There is no object anywhere a server could sign.
    status: "pending_upload",
    hasCloudAsset: false,
    mimeType: null,
    sizeBytes: null,
    transcriptStatus: "not_configured",
    transcriptText: null,
    transcriptErrorSafe: null,
    transcriptProvider: null,
    viewCount: video.viewCount,
    thumbnailTone: video.thumbnailTone,
  };
}

/**
 * The card's overflow menu.
 *
 * Rendered only for a `manage_videos` holder on a cloud record, and only ever
 * OUTSIDE the card's own button — a menu trigger nested inside a button is
 * invalid markup and, more practically, unreachable by keyboard because the
 * outer button swallows the events.
 *
 * The label names the video, so a screen reader user knows which card's menu
 * they have opened in a grid of them.
 */
function VideoCardActions({
  title,
  onEdit,
  onDelete,
}: {
  title: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${title}`}
          className="flex size-7 items-center justify-center rounded-[var(--radius-xs)] bg-surface/90 text-muted-foreground shadow-soft transition-colors hover:bg-surface hover:text-foreground focus-visible:ring-2 focus-visible:ring-selected focus-visible:outline-none"
        >
          <MoreVertical className="size-3.5" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil aria-hidden />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem tone="danger" onSelect={onDelete}>
          <Trash2 aria-hidden />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
