"use client";

import Link from "next/link";
import { BookOpen, FileStack, Info, PlayCircle } from "lucide-react";

import { SourceCard } from "@/components/source-card";
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
export function ContextPanel({ messages }: { messages: ChatMessage[] }) {
  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");

  const citations = lastAssistant?.citations ?? [];
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

      <section className="mt-5">
        <div className="mb-2 flex items-center gap-2">
          <BookOpen className="size-3.5 text-muted-foreground" aria-hidden />
          <p className="eyebrow">Sources for this answer</p>
        </div>
        {citations.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-border-strong px-3 py-4 text-xs leading-relaxed text-muted-foreground">
            Ask a question and the documents behind the answer appear here — with
            the page or section they came from.
          </p>
        ) : (
          <div className="space-y-2">
            {citations.map((citation, index) => (
              <SourceCard
                key={`${citation.documentId}-${citation.locator}`}
                citation={citation}
                index={index}
              />
            ))}
          </div>
        )}
      </section>

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
          <Button asChild variant="secondary" size="sm" className="w-full justify-start">
            <Link href="/forms/create">Create a form from this conversation</Link>
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
