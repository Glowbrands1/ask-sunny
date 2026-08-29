"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, FilePlus2 } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { RichText } from "@/components/rich-text";
import { SourceCardList } from "@/components/source-card";
import { VideoSuggestionCard } from "@/components/video-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ANSWER_MODE_LABEL } from "@/data/demo/chat";
import { videoById } from "@/data/demo/videos";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils/cn";
import { formatTime } from "@/lib/utils/date";
import type { ChatMessage } from "@/types";
import { storeFormHandoff } from "./handoff";

export function MessageBubble({
  message,
  onSuggestion,
}: {
  message: ChatMessage;
  onSuggestion: (value: string) => void;
}) {
  const { user } = useSession();
  const router = useRouter();

  if (message.role === "user") {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[min(38rem,88%)] rounded-[var(--radius-lg)] rounded-tr-sm border border-[color-mix(in_srgb,var(--primary)_18%,transparent)] bg-primary-soft px-4 py-3">
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-primary-soft-foreground">
            {message.content}
          </p>
          <p className="mt-1.5 text-[11px] text-primary-soft-foreground/70">
            {formatTime(message.createdAt)}
          </p>
        </div>
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[10px] font-semibold text-muted-foreground">
          {user.avatarInitials}
        </span>
      </div>
    );
  }

  const videos = (message.recommendedVideoIds ?? [])
    .map((id) => videoById(id))
    .filter((video): video is NonNullable<typeof video> => Boolean(video));

  const handleOpenForm = () => {
    if (!message.formHandoff) return;
    storeFormHandoff(message.formHandoff);
    router.push("/forms/create?from=chat");
  };

  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft">
        <SunMark className="size-4" />
      </span>
      <div className="min-w-0 max-w-[min(46rem,92%)] flex-1">
        <div className="rounded-[var(--radius-lg)] rounded-tl-sm border border-border bg-surface px-4 py-3.5 shadow-soft">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground">Sunny</span>
            {message.mode ? (
              <Badge tone="outline" size="sm">
                {ANSWER_MODE_LABEL[message.mode]}
              </Badge>
            ) : null}
            <span className="text-[11px] text-subtle-foreground">
              {formatTime(message.createdAt)}
            </span>
          </div>

          <RichText content={message.content} />

          {message.formHandoff ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--accent)_22%,transparent)] bg-accent-soft px-4 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface text-accent">
                <FilePlus2 className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-accent-soft-foreground">
                  Draft ready — {message.formHandoff.templateName}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-accent-soft-foreground/85">
                  Opens pre-filled in Create a Form. Every field is editable
                  before you save.
                </p>
              </div>
              <Button variant="accent" size="sm" onClick={handleOpenForm}>
                Open in Create a Form
                <ArrowRight />
              </Button>
            </div>
          ) : null}
        </div>

        {message.citations && message.citations.length > 0 ? (
          <SourceCardList citations={message.citations} className="mt-3" />
        ) : null}

        {videos.length > 0 ? (
          <div className="mt-3">
            <p className="eyebrow mb-2">
              {videos.length === 1
                ? "Here is a training video that may help"
                : "Training that may help"}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {videos.map((video) => (
                <VideoSuggestionCard key={video.id} video={video} />
              ))}
            </div>
          </div>
        ) : null}

        {message.followUpSuggestions && message.followUpSuggestions.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.followUpSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSuggestion(suggestion)}
                className={cn(
                  "rounded-full border border-border bg-surface px-3 py-1.5 text-left text-xs text-muted-foreground shadow-soft transition-colors",
                  "hover:border-border-strong hover:text-foreground",
                )}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ThinkingBubble() {
  return (
    <div className="flex gap-3" aria-live="polite">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft">
        <SunMark className="size-4" />
      </span>
      <div className="rounded-[var(--radius-lg)] rounded-tl-sm border border-border bg-surface px-4 py-3.5 shadow-soft">
        <span className="sr-only">Sunny is thinking</span>
        <span className="flex items-center gap-1.5" aria-hidden>
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="size-1.5 rounded-full bg-primary"
              style={{
                animation: "sunny-pulse-dot 1.1s ease-in-out infinite",
                animationDelay: `${index * 0.16}s`,
              }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}
