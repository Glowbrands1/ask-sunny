"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Play } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { RichText } from "@/components/rich-text";
import { SourceList } from "@/components/source-list";
import { ANSWER_MODE_LABEL } from "@/data/demo/chat";
import { videoById } from "@/data/demo/videos";
import { formatTime } from "@/lib/utils/date";
import { formatDuration } from "@/lib/utils/format";
import { chatErrorTitle } from "@/features/chat/chat-error";
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
 *
 * IT RENDERS ONE ANSWER AND KNOWS NOTHING ABOUT THE THREAD. The band stacks as
 * many of these as the conversation has, so what varies between them arrives as
 * props — `onAsk` for a caller that can continue in place, `showContinue` so the
 * hand-off link appears once — rather than as a mode this component switches on.
 */
export function AnswerSheet({
  message,
  conversationId,
  onDismiss,
  onAsk,
  showContinue = true,
}: {
  message: ChatMessage;
  conversationId: string;
  onDismiss: () => void;
  /**
   * Ask a follow-up WITHOUT LEAVING THE PAGE, when the caller can hold a
   * conversation. The Overview's band can now, so its follow-up chips continue
   * the thread in place; a caller that cannot simply omits this and the chips
   * carry the question to the chat page as they always did.
   */
  onAsk?: (question: string) => void;
  /**
   * False on every answer but the newest in a thread. The hand-off link is
   * useful once; under each of six answers it is a column of the same button.
   */
  showContinue?: boolean;
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
   * ONE OF THEM IS OUTLINED IN CORAL: the one that leads to creating a form.
   * It earns a colour because it does something different from the others,
   * which only continue reading.
   *
   * THE SIGNAL IS THE ANSWER'S OWN `formProposal`, built server-side from the
   * published, permitted template library. The client-side keyword detector
   * this used to ask no longer exists on this branch, and that is the better
   * arrangement: guessing from a chip's wording would colour a chip that leads
   * nowhere.
   *
   * IT HANDS OFF RATHER THAN CREATING ANYTHING, and it still does now that the
   * Overview can hold a conversation. Confirming a proposal is a multi-step flow
   * against a real instance and a pinned template version; it lives on the chat
   * page, and the Overview must not grow a second path into HR records. This is
   * the one chip that deliberately leaves the page.
   */
  const followUps = message.followUpSuggestions ?? [];
  const proposal = message.formProposal;

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
          THE WAY TO THE FULL THREAD, not the way to continue thinking. The
          Overview holds a conversation now, so this is no longer the only route
          onward — it adopts this same conversation on the chat page, where the
          history rail and the document context are.
        */}
        {showContinue ? (
          <button
            type="button"
            onClick={() => continueInChat()}
            className="pill-action ml-auto bg-band text-band-foreground"
          >
            Continue in Ask Sunny
            <ArrowUpRight className="size-3" aria-hidden />
          </button>
        ) : null}
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
            {/*
              THE BODY IS A SENTENCE HERE, so it starts like one. In the source
              text it is a clause following a colon — "next step: if you are
              seeing a pattern" — and once the label is lifted into a heading the
              lowercase "if" reads as a truncation. Only the first character is
              touched, and only when it is a lowercase letter, so a body opening
              with a name or a figure is left as written. The shared `RichText`
              callout does the same thing for the same reason.
            */}
            <p className="text-[13.5px] leading-[1.5] text-foreground">
              {/^[a-z]/.test(nextStep)
                ? nextStep[0].toUpperCase() + nextStep.slice(1)
                : nextStep}
            </p>
          </div>
        ) : null}

        {/* --------------------------------------------------------- sources -- */}
        {/*
          THE SHARED LIST. This markup used to live here and a near-copy of it
          lived in the chat thread — which is how the two drifted, with only
          this one linking into the knowledge base. One component now, so a
          citation opens from wherever the answer was read.
        */}
        <SourceList citations={citations} className="mt-4" />

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
        {followUps.length > 0 || proposal ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {proposal ? (
              <button
                type="button"
                onClick={() => continueInChat()}
                className="rounded-full border border-measure-flagged bg-surface px-3.5 py-1.5 text-[11.5px] font-bold text-measure-flagged-foreground transition-colors hover:bg-hover-surface"
              >
                Continue — {proposal.templateName}
              </button>
            ) : null}
            {followUps.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                /* Continue HERE where the caller can, otherwise carry it to the
                   chat page — the behaviour this always had. */
                onClick={() =>
                  onAsk ? onAsk(suggestion) : continueInChat(suggestion)
                }
                className="rounded-full border border-border-strong bg-surface px-3.5 py-1.5 text-[11.5px] font-bold text-foreground transition-colors hover:border-brand-yellow"
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
