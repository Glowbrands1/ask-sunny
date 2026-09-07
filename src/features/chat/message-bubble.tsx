"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, FilePlus2, RotateCcw, Settings2 } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { RichText } from "@/components/rich-text";
import { VideoSuggestionCard } from "@/components/video-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ANSWER_MODE_LABEL } from "@/data/demo/chat";
import { Notice } from "@/components/ui/feedback";
import { videoById } from "@/data/demo/videos";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils/cn";
import { formatTime } from "@/lib/utils/date";
import type { ChatFormProposal, ChatMessage } from "@/types";
import { chatErrorTitle } from "./chat-error";

export function MessageBubble({
  message,
  onSuggestion,
  onRetry,
}: {
  message: ChatMessage;
  onSuggestion: (value: string) => void;
  onRetry?: (question: string) => void;
}) {
  const { user, isAdmin } = useSession();

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

  // A failed turn is rendered as a failure, never inside an answer bubble.
  // Nothing about it should read as something Sunny said.
  if (message.error) {
    return <ChatErrorBubble message={message} onRetry={onRetry} isAdmin={isAdmin} />;
  }

  const videos = (message.recommendedVideoIds ?? [])
    .map((id) => videoById(id))
    .filter((video): video is NonNullable<typeof video> => Boolean(video));

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

          {message.formProposal ? (
            <FormProposalCard proposal={message.formProposal} />
          ) : null}

          {/*
            A CONVERSATION FROM BEFORE PHASE 2.
            Chat lives in the browser's IndexedDB, so a manager can still scroll
            back to a turn carrying a `formHandoff` — a drafted set of field
            values produced by the prototype flow, with the employee, the
            incident and the follow-up date defaulted where nothing had been
            said. It used to render an "Open in Create a Form" button that
            carried those values across.

            THE BUTTON IS GONE AND IS NOT REPLACED. Re-opening one of those
            drafts today would take values that were never facts and put them in
            front of somebody about to file an HR record. The turn stays
            readable as the prose it always was, with a line saying why it no
            longer leads anywhere.
          */}
          {message.formHandoff && !message.formProposal ? (
            <p className="mt-4 rounded-[var(--radius-md)] border border-border bg-surface-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              This draft came from an earlier version of Ask Sunny, which filled
              in details nobody had given it. It no longer opens in Create a
              Form. Start the form there instead, or ask Sunny again.
            </p>
          ) : null}
        </div>

        {message.coverage === "insufficient" ? (
          <Notice tone="neutral" className="mt-3">
            <span className="font-semibold text-foreground">
              Not covered by the knowledge base
            </span>
            <p className="mt-0.5">
              Sunny found no company document that answers this, so there are no
              sources to show. Anything above is general guidance, not{" "}
              company policy — check with your manager before acting on it.
            </p>
          </Notice>
        ) : null}

        {/*
          NO SOURCE-MATERIAL BLOCK UNDER AN ANSWER.
          This rendered a heading and a card per excerpt — document title,
          locator, category, excerpt preview — beneath every grounded answer.
          A manager asking "what is the tardiness policy" wants the answer, not
          a bibliography taking more height than it.

          PRESENTATION ONLY, AND DELIBERATELY NOT REPLACED. `message.citations`
          is still produced by retrieval, still returned by the API and still
          carried on the message: nothing about grounding, ranking, coverage or
          the insufficient-coverage notice below changed. A collapsed panel, a
          "View sources" affordance or a count badge would each be a smaller
          version of the thing that was asked to go, so there is none.
        */}

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

/**
 * ============================================================================
 * A FORM PROPOSAL — WHAT SUNNY WOULD CREATE, AND WHAT IT IS STILL MISSING
 * ============================================================================
 *
 * NOTHING HERE IS A FORM. There is no instance, no template version, no field
 * values, no follow-up date, no status. Which is why there is no Create
 * button, no Finalize, no Download PDF and no "start another": confirming a
 * proposal into a record is not built, and a control that looks like it works
 * is worse than an absent one.
 *
 * SO THE CARD IS ALL STATEMENT AND NO ACTION. It says which form, what Sunny
 * established, and — in the same list, at the same weight — what it could not.
 * A missing value reads as missing rather than as a blank that might fill
 * itself in.
 */
function FormProposalCard({ proposal }: { proposal: ChatFormProposal }) {
  return (
    <div className="mt-4 rounded-[var(--radius-md)] border border-border bg-surface-muted px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface text-muted-foreground">
          <FilePlus2 className="size-3.5" aria-hidden />
        </span>
        <p className="text-[13px] font-semibold text-foreground">
          {proposal.templateName}
        </p>
        <Badge tone="outline" size="sm">
          Proposal — nothing created
        </Badge>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <ProposalRow label="Employee">
          {proposal.employeeName ?? (
            <Missing>Not yet — tell Sunny who this form is about</Missing>
          )}
        </ProposalRow>
        <ProposalRow label="Salon">
          {proposal.locationId ? (
            /*
             * THE VERIFIED ID, NOT AN INVENTED NAME. There is no salon roster
             * to resolve a display name from, and `DEMO_LOCATIONS` is seeded
             * demo data — putting a fictional salon name in front of somebody
             * about to file a disciplinary record is the class of thing this
             * phase exists to stop. `locationName` stays null until a roster
             * exists; see docs/chat-phase-2.md.
             */
            <span className="font-mono text-[11px] text-foreground">
              {proposal.locationId}
            </span>
          ) : (
            <Missing>
              {proposal.locationResolution === "needs_selection"
                ? "Not set — say which salon this is about"
                : "Not set — Ask Sunny could not verify one"}
            </Missing>
          )}
        </ProposalRow>
      </dl>
    </div>
  );
}

function ProposalRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-subtle-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </>
  );
}

function Missing({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground italic">{children}</span>;
}

/**
 * A failed turn.
 *
 * Visually distinct from an answer on purpose: it carries no Sunny avatar copy
 * that could read as speech, it names what went wrong, and it offers "Try
 * again" only when trying again could actually help. Configuration problems
 * point an administrator at the admin screen instead of inviting a retry that
 * cannot succeed.
 */
function ChatErrorBubble({
  message,
  onRetry,
  isAdmin,
}: {
  message: ChatMessage;
  onRetry?: (question: string) => void;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const error = message.error!;

  return (
    <div className="flex gap-3" role="alert">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-status-attention-bg text-status-attention">
        <AlertTriangle className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 max-w-[min(46rem,92%)] flex-1">
        <Notice tone="attention" title={chatErrorTitle(error.kind)}>
          <p>{error.message}</p>

          {error.missing && error.missing.length > 0 && isAdmin ? (
            <p className="mt-2">
              Not configured:{" "}
              <span className="font-mono text-xs">{error.missing.join(", ")}</span>
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {error.retryable && onRetry ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onRetry(error.question)}
              >
                <RotateCcw />
                Try again
              </Button>
            ) : null}

            {error.kind === "not_configured" && isAdmin ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/admin/integrations")}
              >
                <Settings2 />
                Open service configuration
              </Button>
            ) : null}
          </div>
        </Notice>

        <p className="mt-2 text-xs text-subtle-foreground">
          Nothing was answered from memory. Sunny does not guess when it cannot
          reach the knowledge base.
        </p>
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
