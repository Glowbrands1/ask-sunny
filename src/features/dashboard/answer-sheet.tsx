"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Play } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { RichText } from "@/components/rich-text";
import { cn } from "@/lib/utils/cn";
import { ANSWER_MODE_LABEL } from "@/data/demo/chat";
import { videoById } from "@/data/demo/videos";
import { formatTime } from "@/lib/utils/date";
import { formatDuration } from "@/lib/utils/format";
import { chatErrorTitle } from "@/features/chat/chat-error";
import { detectTemplate, isFormIntent, publishedTemplateKeyFor } from "@/lib/forms/chat-flow";
import type { ChatMessage } from "@/types";

/**
 * THE ANSWER, ON PAPER, IN PLACE.
 *
 * The direction's rule: the ask bar stays put, the answer opens underneath it on
 * white, and the overview collapses to a strip rather than being pushed off
 * screen. Dark bar, light answer — a six-paragraph policy answer read on
 * near-black is worse than on white — and the reading measure is held near 78
 * characters, which is what `max-w-[78ch]` is doing.
 *
 * Every block here is driven by the real AskResponse the chat API already
 * returns: the mode tag, the citations with their locators, the recommended
 * video, the form handoff and the follow-up suggestions. Nothing is invented for
 * the sake of matching the mockup.
 */
export function AnswerSheet({
  message,
  conversationId,
  onDismiss,
}: {
  message: ChatMessage;
  conversationId: string;
  onDismiss: () => void;
}) {
  const router = useRouter();

  /* Carry the whole turn to the chat page — same conversation, real thread. */
  const continueInChat = (question?: string) => {
    const params = new URLSearchParams({ c: conversationId });
    if (question) params.set("q", question);
    router.push(`/chat?${params.toString()}`);
  };

  if (message.error) {
    /*
     * A failed turn reads as a failure on the sheet, never as something Sunny
     * said. The detail and the retry live on the chat page, which is where the
     * thread and its history already are.
     */
    return (
      <div className="border-b border-border bg-surface px-5 py-5 sm:px-6">
        <div className="max-w-[78ch]">
          <p className="display text-[15px] text-measure-flagged-foreground">
            {chatErrorTitle(message.error.kind)}
          </p>
          <p className="mt-2 text-[13.5px] leading-[1.62] text-body-foreground">
            {message.error.message}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => continueInChat(message.error?.question)}
              className="pill-action bg-band text-band-foreground"
            >
              Open in Ask Sunny
              <ArrowUpRight className="size-3" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="pill-action border border-border-strong bg-surface text-foreground"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { body, nextStep } = splitNextStep(message.content);
  const citations = message.citations ?? [];
  const video = (message.recommendedVideoIds ?? [])
    .map((id) => videoById(id))
    .find((entry) => Boolean(entry));

  /*
   * The follow-up chips.
   *
   * ONE OF THEM IS OUTLINED IN CORAL: the one that starts a coaching form from
   * this answer. That is the path the direction is after — ask, then build the
   * form, without leaving the page — and it is worth a colour precisely because
   * it does something different from the others, which only continue reading.
   *
   * The signal is the app's own `isFormIntent`, the same detector the chat flow
   * uses to decide a question is a form request, so the chip is coral when the
   * suggestion would genuinely open Create a Form and never merely because it
   * happens to be first.
   *
   * ONLY THE FIRST such chip. The direction's rule for a row of chips is one
   * treatment throughout; a second coloured chip would make neither mean
   * anything.
   */
  const followUps = message.followUpSuggestions ?? [];
  const handoff = message.formHandoff;
  const formChipIndex = followUps.findIndex((suggestion) => isFormIntent(suggestion));

  /* Straight into the form the suggestion names, seeded like the chat handoff. */
  const startForm = (suggestion: string) => {
    const template = detectTemplate(suggestion);
    const key = publishedTemplateKeyFor(template.id);
    router.push(
      key
        ? `/forms/create?from=overview&template=${key}`
        : "/forms/create?from=overview",
    );
  };

  return (
    <div className="border-b border-border bg-surface px-5 py-5 sm:px-6 sm:pt-[22px] sm:pb-6">
      {/* ------------------------------------------------------------ head -- */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-brand-yellow">
          <SunMark className="size-[17px]" onDark />
        </span>
        <span className="display text-[16px] text-foreground">Sunny</span>
        {message.mode ? (
          <span className="rounded-[4px] bg-brand-yellow px-2 py-[3px] text-[8.5px] font-black tracking-[0.08em] text-brand-yellow-foreground uppercase">
            {ANSWER_MODE_LABEL[message.mode].split("—")[0].trim()}
          </span>
        ) : null}
        <span className="text-[10.5px] text-muted-foreground">
          {formatTime(message.createdAt)}
        </span>
        {/*
          CAP IT, THEN HAND OFF. The Overview is a place for ONE question;
          anything longer becomes a real thread on the chat page, where it shows
          in history.
        */}
        <button
          type="button"
          onClick={() => continueInChat()}
          className="pill-action ml-auto bg-band text-band-foreground"
        >
          Continue in Ask Sunny
          <ArrowUpRight className="size-3" aria-hidden />
        </button>
      </div>

      {/* ------------------------------------------------------------ body -- */}
      <div className="max-w-[78ch]">
        <RichText
          content={body}
          className="text-[13.5px] leading-[1.62] text-body-foreground"
        />

        {/*
          The manager-ready next step, lifted out of the prose into its own
          block. The answers mark it with a bold lead-in, so this is a real part
          of the answer being given the weight the direction gives it — not a
          field invented to fill the mockup. When an answer does not carry one,
          the block simply does not render.
        */}
        {nextStep ? (
          <div className="my-4 rounded-lg border-l-4 border-brand-yellow bg-brand-yellow-soft px-3.5 py-3">
            <p className="eyebrow mb-1 text-brand-yellow-soft-foreground">
              Your manager-ready next step
            </p>
            <p className="text-[13.5px] leading-[1.5] text-foreground">{nextStep}</p>
          </div>
        ) : null}

        {/* --------------------------------------------------------- sources -- */}
        {citations.length > 0 ? (
          <div className="mt-4">
            <p className="eyebrow mb-2">Sources</p>
            {citations.map((citation, index) => (
              <Link
                key={`${citation.documentId}-${index}`}
                href={`/knowledge?document=${citation.documentId}`}
                className="flex items-baseline gap-2.5 border-t border-border-row py-1.5 text-[12.5px] first:border-t-0 first:pt-0 hover:underline"
              >
                <span className="mt-px grid size-[17px] shrink-0 place-items-center rounded-[4px] bg-brand-yellow text-[9.5px] font-black text-brand-yellow-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="font-bold text-foreground">
                    {citation.documentTitle}
                  </span>
                  <span className="text-muted-foreground"> — {citation.excerpt}</span>
                </span>
                <span className="ml-auto shrink-0 pl-2 text-[10.5px] whitespace-nowrap text-muted-foreground">
                  {citation.locator}
                </span>
              </Link>
            ))}
          </div>
        ) : null}

        {/* ----------------------------------------------------------- video -- */}
        {video ? (
          <Link
            href={`/videos?video=${video.id}`}
            className="mt-3.5 flex max-w-[420px] items-center gap-3 rounded-xl bg-surface-muted px-3.5 py-2.5 transition-colors hover:bg-hover-surface"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-band text-brand-yellow">
              <Play className="size-3 fill-current" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-bold text-foreground">
                {video.title}
              </span>
              <span className="text-[10.5px] text-muted-foreground">
                {formatDuration(video.durationSeconds)} · {video.category}
              </span>
            </span>
          </Link>
        ) : null}

        {/* ------------------------------------------------------ follow-ups -- */}
        {followUps.length > 0 || handoff ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {handoff ? (
              <button
                type="button"
                onClick={() => router.push("/forms/create")}
                className="rounded-full border border-measure-flagged bg-surface px-3.5 py-1.5 text-[11.5px] font-bold text-measure-flagged-foreground transition-colors hover:bg-hover-surface"
              >
                Create a form — {handoff.templateName}
              </button>
            ) : null}
            {followUps.map((suggestion, index) => {
              const startsForm = index === formChipIndex;
              return (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() =>
                    startsForm ? startForm(suggestion) : continueInChat(suggestion)
                  }
                  className={cn(
                    "rounded-full bg-surface px-3.5 py-1.5 text-[11.5px] font-bold transition-colors",
                    startsForm
                      ? "border border-measure-flagged text-measure-flagged-foreground hover:bg-hover-surface"
                      : "border border-border-strong text-foreground hover:border-brand-yellow",
                  )}
                >
                  {suggestion}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Lift the manager-ready next step out of the answer prose.
 *
 * The assistant marks it with a bold lead-in on its own line. This is a
 * PRESENTATION split of text the answer already contains — if the marker is
 * absent, the whole answer renders as body and no callout appears, which is what
 * happens for a Quick answer that has no next step to give.
 */
export function splitNextStep(content: string): { body: string; nextStep: string | null } {
  const marker = /^\*\*Your manager-ready next step:\*\*\s*/im;
  const lines = content.split("\n");
  const index = lines.findIndex((line) => marker.test(line.trim()));
  if (index === -1) return { body: content, nextStep: null };

  const nextStep = lines[index].trim().replace(marker, "").trim();
  if (!nextStep) return { body: content, nextStep: null };

  const body = [...lines.slice(0, index), ...lines.slice(index + 1)].join("\n").trim();
  return { body, nextStep };
}
