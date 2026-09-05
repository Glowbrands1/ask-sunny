"use client";

import * as React from "react";
import { FileText, Info } from "lucide-react";

import { Notice } from "@/components/ui/feedback";
import type { TrainingVideo } from "@/lib/videos/types";

/**
 * ============================================================================
 * THE TRANSCRIPT SECTION, INCLUDING WHEN THERE IS NO TRANSCRIPT
 * ============================================================================
 *
 * Every state here is a real state of the data, and the one that matters most
 * is the one that ships today: `not_configured`. No speech-to-text provider is
 * wired — every option is paid, and none was chosen — so the honest thing to
 * show an administrator is what is missing, not a spinner that will never stop.
 *
 * TEXT IS RENDERED ONLY WHEN THE STATUS IS `ready` AND TEXT EXISTS. Two guards
 * for one rule, because a "Transcript" heading over fabricated or partial words
 * is worse than no transcript at all — somebody would act on it. The server
 * strips the text from any other status, the database refuses a `ready` row
 * with no text, and this component checks again.
 */
export function VideoTranscript({
  video,
  canManage,
}: {
  video: TrainingVideo;
  canManage: boolean;
}) {
  return (
    <section className="mt-5 space-y-3 border-t border-border pt-5">
      <div className="flex items-center gap-2">
        <FileText className="size-3.5 text-muted-foreground" aria-hidden />
        <h3 className="text-[13px] font-semibold text-foreground">Transcript</h3>
      </div>
      <Body video={video} canManage={canManage} />
    </section>
  );
}

function Body({ video, canManage }: { video: TrainingVideo; canManage: boolean }) {
  switch (video.transcriptStatus) {
    case "ready":
      // BOTH conditions. A status alone is not evidence that words exist.
      return video.transcriptText ? (
        <TranscriptText text={video.transcriptText} />
      ) : (
        <Muted>
          This transcript is marked ready but carries no text, so nothing is shown.
        </Muted>
      );

    case "queued":
    case "processing":
      return <Muted>Transcript is being generated.</Muted>;

    case "failed":
      return (
        <div className="space-y-2">
          <Muted>
            {video.transcriptErrorSafe ?? "Transcript could not be generated."}
          </Muted>
          {canManage ? (
            <p className="text-xs text-subtle-foreground">
              Retry is available once a speech-to-text provider is configured.
            </p>
          ) : null}
        </div>
      );

    case "not_configured":
      return (
        <Notice tone="neutral" icon={<Info />}>
          {canManage ? (
            <>
              No speech-to-text provider is configured, so transcripts cannot be
              generated yet. Playback is unaffected. Enabling this needs a
              transcription account and key added to the deployment — every
              provider charges per minute of audio.
            </>
          ) : (
            <>Transcripts are not available yet. Playback is unaffected.</>
          )}
        </Notice>
      );

    case "not_started":
    default:
      return <Muted>No transcript has been generated for this video yet.</Muted>;
  }
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-muted-foreground">{children}</p>;
}

/**
 * A long transcript in a bounded, scrollable area.
 *
 * An hour of speech is thousands of words, and letting it set the height of a
 * modal would push everything else — the player, the metadata — off the screen.
 * Paragraphs are split on blank lines so the text reads rather than arriving as
 * one wall.
 */
function TranscriptText({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return (
    <div className="scroll-slim max-h-72 space-y-2.5 overflow-y-auto rounded-[var(--radius-md)] border border-border bg-surface-muted p-3.5">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="text-[13px] leading-relaxed text-foreground">
          {paragraph}
        </p>
      ))}
    </div>
  );
}
