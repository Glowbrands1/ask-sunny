"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FilePlus2, Loader2, RotateCcw, Settings2 } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { RichText } from "@/components/rich-text";
import { SourceList } from "@/components/source-list";
import { VideoSuggestionCard } from "@/components/video-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/field";
import { ANSWER_MODE_LABEL } from "@/data/demo/chat";
import { Notice } from "@/components/ui/feedback";
import { videoById } from "@/data/demo/videos";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils/cn";
import { formatTime } from "@/lib/utils/date";
import { formsFetch } from "@/features/forms/forms-fetch";
import type { ChatFormInstanceRef, ChatFormProposal, ChatMessage } from "@/types";
import { chatErrorTitle } from "./chat-error";
import { FormPicker } from "./form-picker";
import { DRAFT_FAILED_WARNING, createInlineForm } from "./create-inline-form";
import { InlineForm, type PrefillState } from "./inline-form";

export function MessageBubble({
  message,
  conversation,
  onSuggestion,
  onRetry,
  onFormCreated,
  onStartAnother,
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
  /** Begins a fresh form request in the same thread. Never reuses an instance. */
  onStartAnother?: () => void;
}) {
  const { user, isAdmin } = useSession();

  if (message.role === "user") {
    /*
     * ONE SIDE BUBBLED AND ONE SIDE NOT.
     *
     * The Marquee Chat artifact's fifth item, and the reason is scanning rather
     * than decoration: "Sunny's reply sits directly on the peach ground at a
     * 78-character measure. Only the manager's own message gets a bubble — one
     * side bubbled and one side not is what makes a thread scannable."
     *
     * So the question is a white card on the peach, capped at 44 characters so
     * it stays visibly a question rather than spreading into the width an
     * answer uses. It was the yellow-tinted primary-soft, which put the
     * manager's own typing in the brand's emphasis colour.
     */
    return (
      <div className="flex items-start justify-end gap-3">
        <div className="max-w-[44ch] rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3 shadow-soft">
          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-foreground">
            {message.content}
          </p>
          <p className="mt-1.5 text-[9.5px] text-muted-foreground">
            {formatTime(message.createdAt)}
          </p>
        </div>
        {/* The warm neutral, not the grey: the manager's initials on the peach
            ground need a tint that belongs to it. */}
        <span className="mt-0.5 flex size-[30px] shrink-0 items-center justify-center rounded-full bg-border-strong text-[10px] font-black text-primary-soft-foreground">
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
    /*
     * THE ANSWER IS NOT A CARD.
     *
     * It sat in a white bordered bubble with a shadow, the same object as the
     * question above it. The artifact puts it straight on the peach at a
     * 78-character measure — long enough for a policy answer to read as a
     * document and short enough that the eye returns to the right place — and
     * gives the identity line the display face with a yellow mode tag, so
     * "SUNNY · STANDARD" reads as a byline rather than as a card header.
     */
    <div className="flex gap-3">
      {/*
        THE YELLOW DISC IS THE AVATAR, SO THE SUN INVERTS ONTO IT. Drawn with
        `onDark` the disc and rays are the same yellow as the circle behind
        them and only the lenses survive — the smudge this codebase already hit
        once on the empty state. `onBrand` swaps the two inks.
      */}
      <span className="mt-0.5 grid size-[30px] shrink-0 place-items-center rounded-full bg-brand-yellow">
        <SunMark className="size-[19px]" onBrand />
      </span>
      <div className="min-w-0 max-w-[78ch] flex-1">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="display text-[16px] text-foreground">Sunny</span>
            {message.mode ? (
              <span className="rounded-[var(--radius-xs)] bg-brand-yellow px-2 py-[3px] text-[8.5px] font-black tracking-[0.08em] uppercase text-brand-yellow-foreground">
                {ANSWER_MODE_LABEL[message.mode]}
              </span>
            ) : null}
            <span className="text-[10px] text-muted-foreground">
              {formatTime(message.createdAt)}
            </span>
          </div>

          <RichText content={message.content} />

          {/*
            NO FORM WAS NAMED, so the choices are cards rather than a list in
            the prose above. Choosing one sends the request through the composer
            — the same path a typed request takes.
          */}
          {message.formSelection ? (
            <FormPicker
              selection={message.formSelection}
              onChoose={onSuggestion}
            />
          ) : null}

          {message.formProposal ? (
            <FormProposalCard
              proposal={message.formProposal}
              instanceRef={message.formInstanceRef ?? null}
              conversation={conversation ?? []}
              onCreated={(reference) => onFormCreated?.(message.id, reference)}
              onStartAnother={onStartAnother}
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
          THE DOCUMENTS BEHIND THIS ANSWER, AND EACH ONE OPENS.

          An earlier pass removed this block outright; the current Marquee Chat
          artifact brings it back as a rule and numbered rows rather than as the
          bordered cards that were objected to. It is the SHARED component now —
          see `components/source-list.tsx` — because a near-copy lived on the
          Overview's answer sheet, only that one was clickable, and this one
          having lost its links was a reported regression.
        */}
        <SourceList citations={message.citations ?? []} className="mt-4" />

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
          <div className="mt-4 flex flex-wrap gap-2">
            {message.followUpSuggestions.map((suggestion) => {
              /*
               * ONE CORAL CHIP, AND IT BUILDS THE FORM.
               *
               * The artifact's seventh item: "The follow-up that starts a
               * coaching form is outlined in coral. Everything else stays
               * neutral, so coral still means one thing: act here."
               *
               * OUTLINED, NEVER FILLED. A filled coral chip would be a coral
               * button, and pressing must not look like alarming — the same
               * rule that keeps the alarm bar's own action near-black.
               */
              const buildsForm = /\bform\b/i.test(suggestion);
              return (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => onSuggestion(suggestion)}
                  className={cn(
                    "rounded-[22px] border bg-surface px-3.5 py-[7px] text-left text-[11.5px] font-bold transition-colors",
                    buildsForm
                      ? "border-measure-data text-measure-flagged-foreground hover:bg-followup-attention-soft"
                      : "border-border-strong text-foreground hover:border-brand-yellow",
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
  onStartAnother,
}: {
  proposal: ChatFormProposal;
  instanceRef: ChatFormInstanceRef | null;
  conversation: ChatMessage[];
  onCreated: (reference: ChatFormInstanceRef) => void;
  onStartAnother?: () => void;
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
   * WHICH SALON, WHEN THE ACTOR COVERS SEVERAL.
   *
   * Ids, not names: there is no salon roster, and the only source of a display
   * name in this app is seeded demo data — see docs/chat-phase-3.md. Offering
   * the ids the scope actually proves is honest and answerable; offering
   * invented names would not be.
   *
   * Whatever is chosen is re-authorized against the AccessScope by
   * `POST /api/forms/instances`, so an edited list buys nothing.
   */
  const [salon, setSalon] = React.useState("");

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
        proposal: salon ? { ...proposal, locationId: salon } : proposal,
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
    return (
      <InlineForm
        reference={reference}
        prefill={prefill}
        onStartAnother={onStartAnother}
      />
    );
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
          {salon ? (
            <span className="font-mono text-[11px] text-foreground">{salon}</span>
          ) : proposal.locationResolution === "not_applicable" ? (
            /*
             * NOT A GAP. A global actor is not assigned to a salon, and the
             * server permits a form that names none — so this is an answer, and
             * the card says which answer rather than asking a question with
             * nothing to pick from.
             */
            <Missing>Not recorded — your account covers every salon</Missing>
          ) : proposal.locationId ? (
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
      {/*
        THE ONE QUESTION THE CARD CAN ANSWER FOR ITSELF. A manager assigned to
        several salons is asked here rather than in prose, because the
        authorized set is known and a typed salon name could not be verified
        against anything.
      */}
      {proposal.authorizedLocationIds.length > 1 && !proposal.locationId ? (
        <div className="mt-4 min-w-0 space-y-1.5">
          <Label htmlFor={`salon-${proposal.proposalId}`}>Which salon is this about?</Label>
          <Select
            id={`salon-${proposal.proposalId}`}
            className="min-w-0"
            value={salon}
            onChange={(event) => setSalon(event.target.value)}
          >
            <option value="">Choose a salon…</option>
            {proposal.authorizedLocationIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {proposal.supportsInlineDraft || (salon && proposal.status === "needs_location") ? (
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
