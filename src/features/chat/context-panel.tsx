"use client";

import Link from "next/link";
import { FileStack, Info, PlayCircle } from "lucide-react";

import { VideoSuggestionCard } from "@/components/video-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { videoById } from "@/data/demo/videos";
import { aiProviderStatus } from "@/lib/ai";
import type { ChatMessage } from "@/types";

/**
 * Right-hand context rail: what grounded the most recent answer, what training
 * matched, and an honest note about which provider is answering.
 */
export function ContextPanel({
  messages,
  onCreateForm,
}: {
  messages: ChatMessage[];
  /**
   * Starts a form FROM THIS CONVERSATION, without leaving it.
   *
   * Supplied by `ChatScreen`, which owns the conversation and the send path.
   * This panel is only the trigger: it does not read the manager's turns, does
   * not choose a template and does not create an instance. Doing any of that
   * here would be a second orchestrator competing with the one that works.
   */
  onCreateForm?: () => void;
}) {
  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");

  /*
     THE SECOND SOURCE SURFACE, ALSO REMOVED.
     This rail rendered "Sources for this answer" with a card per excerpt —
     the same material as the block under the answer, in a second place. It
     was the one Phase 1 did not touch, which is why removing the in-thread
     block alone would have left the request half-done.

     `lastAssistant` is still read for the training recommendations below.
  */
  const videos = (lastAssistant?.recommendedVideoIds ?? [])
    .map((id) => videoById(id))
    .filter((video): video is NonNullable<typeof video> => Boolean(video));

  const provider = aiProviderStatus();

  return (
    <div className="scroll-slim h-full overflow-y-auto p-4">
      <div className="rounded-[var(--radius-md)] border border-border bg-surface-muted p-3.5">
        <div className="flex items-center gap-2">
          <Info className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-[13px] font-semibold text-foreground">
            {provider.name}
          </p>
          <Badge tone={provider.connected ? "ready" : "neutral"} size="sm">
            {provider.connected ? "Connected" : "Prototype"}
          </Badge>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {provider.detail}
        </p>
      </div>

      {videos.length > 0 ? (
        <section className="mt-6">
          <div className="mb-2 flex items-center gap-2">
            <PlayCircle className="size-3.5 text-muted-foreground" aria-hidden />
            <p className="eyebrow">Recommended training</p>
          </div>
          <div className="space-y-2">
            {videos.map((video) => (
              <VideoSuggestionCard key={video.id} video={video} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <FileStack className="size-3.5 text-muted-foreground" aria-hidden />
          <p className="eyebrow">Take it further</p>
        </div>
        <div className="space-y-1.5">
          {/*
            AN ACTION, NOT A LINK. This was `<Link href="/forms/create">`, which
            navigated away from the conversation the manager was in the middle
            of — to a builder where they retyped the employee and the incident
            they had just described. The whole point of the button is the
            conversation it is standing next to.
          */}
          <Button
            variant="secondary"
            size="sm"
            className="w-full justify-start"
            disabled={!onCreateForm}
            onClick={onCreateForm}
          >
            Create a form from this conversation
          </Button>
          <Button asChild variant="ghost" size="sm" className="w-full justify-start">
            <Link href="/knowledge">Browse the knowledge base</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="w-full justify-start">
            <Link href="/videos">Browse training videos</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
