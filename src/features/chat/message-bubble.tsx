"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FilePlus2, Loader2, RotateCcw, Settings2 } from "lucide-react";

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
import { formsFetch } from "@/features/forms/forms-fetch";
import type { ChatFormInstanceRef, ChatFormProposal, ChatMessage } from "@/types";
import { chatErrorTitle } from "./chat-error";
import { DRAFT_FAILED_WARNING, createInlineForm } from "./create-inline-form";
import { InlineForm, type PrefillState } from "./inline-form";

export function MessageBubble({
  message,
  conversation,
  onSuggestion,
  onRetry,
  onFormCreated,
}: {
  message: ChatMessage;
  /**
   * The turns this message sits among, for resolving a proposal's
   * `sourceMessageIds` back into the manager's own words.
   */
  conversation?: ChatMessage[];
  onSuggestion: (value: string) => void;
  onRetry?: (question: string) => void;
  /** Persists the created form's id onto this message. */
  onFormCreated?: (messageId: string, reference: ChatFormInstanceRef) => void;
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
            <FormProposalCard
              proposal={message.formProposal}
              instanceRef={message.formInstanceRef ?? null}
              conversation={conversation ?? []}
              onCreated={(reference) => onFormCreated?.(message.id, reference)}
            />
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
function FormProposalCard({
  proposal,
  instanceRef,
  conversation,
  onCreated,
}: {
  proposal: ChatFormProposal;
  instanceRef: ChatFormInstanceRef | null;
  conversation: ChatMessage[];
  onCreated: (reference: ChatFormInstanceRef) => void;
}) {
  const { role, user } = useSession();
  const [creating, setCreating] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  /*
   * WHERE SUNNY'S PREFILL HAS GOT TO, for the editor below.
   *
   * `unknown` is the honest default: a card rendering an `instanceRef` that
   * came back from IndexedDB did not watch that prefill happen and cannot say
   * whether it finished. Only a create in THIS component moves it to `running`.
   */
  const [prefill, setPrefill] = React.useState<PrefillState>({ kind: "unknown" });
  /*
   * THE SAME ID THE PARENT IS BEING ASKED TO PERSIST, KEPT HERE TOO.
   *
   * `onCreated` writes the reference into the conversation, which is what makes
   * it survive a refresh. But the form exists the instant the create returns,
   * whether or not that write lands — and a card that went on offering "Create
   * draft" because a persist failed would let the manager file a second
   * disciplinary record for the same conversation.
   *
   * So the card stops offering the action on its own evidence. The durable copy
   * is still the conversation's; this one just closes the window between them.
   */
  const [created, setCreated] = React.useState<ChatFormInstanceRef | null>(null);

  /*
   * ==========================================================================
   * ONE FORM PER PROPOSAL, AND THE HONEST LIMIT OF THAT CLAIM
   * ==========================================================================
   *
   * `creating` is checked and set in the same synchronous turn as the click,
   * before any await, so a double-click, an Enter-then-click race, or a
   * pointer-and-keyboard activation cannot both get past it. The button is
   * disabled for the duration too, but the ref is what actually guarantees it:
   * a disabled attribute is applied on the next render, which is one tick too
   * late for a genuine double activation.
   *
   * Once an instance exists the action is not rendered at all, so it cannot be
   * pressed a second time — not even after a refresh, because the reference is
   * stored on the message.
   *
   * WHAT THIS DOES NOT COVER, AND THERE IS NO PRETENDING OTHERWISE: a request
   * that reaches the server and whose RESPONSE is lost. The browser sees a
   * failure, the row exists, and pressing the button again would create a
   * second one. Closing that needs a uniqueness constraint on the proposal id,
   * which needs a migration, which this phase does not have. See
   * docs/chat-phase-3.md.
   */
  const inFlight = React.useRef(false);

  async function create() {
    if (inFlight.current) return;
    inFlight.current = true;
    setCreating(true);
    setProblem(null);

    /*
     * Whether the ROW got created, tracked locally because the catch below has
     * to tell two failures apart: one where nothing exists and trying again is
     * right, and one where a real HR record exists and trying again would file
     * a second. `created` state is async and cannot answer this synchronously.
     */
    let rowExists = false;

    try {
      const result = await createInlineForm({
        proposal,
        messages: conversation,
        call: (url, init) => formsFetch(url, role, user.name, init),
        /*
         * SYNCHRONOUS, THE MOMENT THE ROW EXISTS — not after this promise
         * settles. Drafting can run for up to two minutes, and for every
         * second of it a real HR record exists. Persisting it here is what
         * stops the card going on offering "Create draft" over a form that
         * has already been filed.
         */
        onCreated: (reference) => {
          rowExists = true;
          setCreated(reference);
          onCreated(reference);
          /*
           * The row exists and drafting has begun. The editor renders from
           * here on — read-only, saying so — until this settles below.
           */
          setPrefill({ kind: "running" });
        },
      });
      /*
       * SETTLED. `complete` makes the editor re-read the canonical instance, so
       * what appears is what the server stored rather than what the drafting
       * response happened to return.
       */
      setPrefill(
        result.draftWarning
          ? { kind: "failed", message: result.draftWarning }
          : { kind: "complete" },
      );
    } catch (error) {
      setProblem((error as Error).message);
      /*
       * Only a FAILED CREATE releases the guard — the form does not exist, so
       * trying again is right. A create that succeeded never releases it: the
       * row is real, and the card is about to stop offering the action.
       *
       * If the failure came AFTER the row existed, the editor must not be left
       * waiting on a prefill that will never settle.
       */
      if (rowExists) {
        // The row is real. Never release the guard, and never leave the editor
        // waiting on a prefill that will not settle.
        setPrefill({ kind: "failed", message: DRAFT_FAILED_WARNING });
      } else {
        inFlight.current = false;
      }
    } finally {
      setCreating(false);
    }
  }

  const reference = instanceRef ?? created;
  if (reference) {
    return <InlineForm reference={reference} prefill={prefill} />;
  }

  return (
    <div className="mt-4 min-w-0 rounded-[var(--radius-md)] border border-border bg-surface-muted px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface text-muted-foreground">
          <FilePlus2 className="size-3.5" aria-hidden />
        </span>
        <p className="text-[13px] font-semibold text-foreground">{proposal.templateName}</p>
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
             * exists; see docs/chat-phase-3.md.
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

      {/*
        THE ONLY CONTROL ON THIS CARD, AND ONLY WHEN IT WORKS.

        `supportsInlineDraft` is set server-side and is true only for a template
        the inline editor supports AND a proposal with nothing missing. A
        proposal still needing the employee or the salon gets no button — not a
        disabled one, because the gap is the reason it is not offered, and a
        greyed-out control invites the manager to hunt for what would enable it.

        There is no Finalize, no Download PDF, no Start another and no View in
        Form Monitoring. Those are Phase 4, and a dead Finalize would reproduce
        exactly the "Coming later" problem this workstream just removed.
      */}
      {proposal.supportsInlineDraft ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => void create()} disabled={creating}>
            {creating ? <Loader2 className="animate-spin" /> : null}
            {creating ? "Creating…" : "Create draft"}
          </Button>
          {problem ? (
            <span className="text-xs text-status-attention">{problem}</span>
          ) : null}
        </div>
      ) : null}
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
