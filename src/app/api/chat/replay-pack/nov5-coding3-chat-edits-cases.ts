import { expect } from "vitest";

import { KEARNEY, STAFF, noClaimWithoutUpdate, replyMatchesDiff, savedForm, type ReplayAnswer, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";
import { REFUSAL_ROSTER } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * CODING 3 — "EDITS SAID IN CHAT NEVER REACH THE CARD" (both apps, 5 Nov 2026)
 * ============================================================================
 *
 * A manager's exact production wording (people invented; Rowan Kestrel is the
 * pack's STAFF):
 *
 *   (a) "can you upate the draft with these details of coaching?" →
 *       "it didnt edit in the card" → "the details we just discussed!!!"
 *   (b) "i don't see the details updated in the draft card.  Do i need to copy
 *       and paste it?  or should it be automatically updating?"
 *
 * EXTENDS nov3-stepb-make-that-update and nov3-stepb-write-the-observation
 * (`nov3-step-b-cases.ts`), which give the details AFTER Create and run with
 * Step B's flags. What those do not cover, and these cases do, with
 * production's flags only (no fix exists yet, so no fixFlags):
 *
 *   1. The details were discussed BEFORE the card: the bot's own how-to answer
 *      held them, then the card, then (a). "these details" and "the details
 *      we just discussed" are read from the LAST reply only
 *      (`form-content-turn.ts` previousAnswer: the card, then the bot's own
 *      "I haven't changed …"). Step B and the edit tool accept the last reply
 *      only as an offer, so with their flags on too nothing writes the
 *      answer's details (replayed 5 Nov 2026).
 *   2. The manager's own account given before "Create a coaching form.": the
 *      card shows it as its Observation, and the drafting model is never
 *      handed it (THIS_PERSONS_TURNS_ENABLED starts the draft's turns at the
 *      request, `this-persons-turns.ts`).
 *   3. (b) answered truthfully. The live answer's "It should update
 *      automatically — no copy-and-paste needed" goes out as it is: the
 *      honest-reply guard (FORM_EDIT_HONEST_REPLY_ENABLED, CLAIM_GUARD_ENABLED,
 *      `honestFormReply`) reads claims from a list of phrasings, and this one
 *      ("copy-and-paste", "update automatically", "the details are on the
 *      draft card") is not on it. Where the guard does catch a claim, its reply
 *      invites "make that update" — which then writes nothing, because that
 *      reply is the "previous answer" it reads (replayed 5 Nov 2026).
 *
 * The drafting and revision models are the pack's stand-ins (they write
 * nothing) unless a case says otherwise, as in production's reports.
 * Invariants only: what is SAVED, what is CLAIMED, and what the drafting
 * model is HANDED.
 */

type T = ReplayContext;

/** The spray-tan coaching details the bot gave as a how-to answer, before any card (the live answer's shape). */
const HOW_TO_ANSWER = [
  "Here's how to coach on the spray tan booth:",
  "**Details of Coaching:** Press **Start Session** only once the guest is in the booth and ready. Press **Session Complete** only after the spray cycle has finished and the guest has been sprayed.",
].join("\n\n");
const IN_THE_ANSWER = [/guest is in the booth/i, /spray cycle has finished/i];

/** What Rowan did, in the b17 mechanism's wording here (as `nov3-step-b-cases.ts`). */
const ROWAN_DID = "rowan marked a session as complete but the guest hadn't been sprayed yet";
const SAID = /rowan marked a session as complete but the guest hadn't been sprayed yet/i;

/** The bot's own lines — the card, a no-change reply, an honest reply — are never the form's content. */
const BOTS_OWN_WORDS = /Here is what I would put|I haven't changed|Nothing on the form has changed|Tell me which part to change|Create the draft here/i;

function start(t: T) {
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
}

/** One turn on the open draft: no claim without a change, and the bot's own lines never written into it. */
async function onDraft(t: T, thread: ReplayThread, id: string, text: string): Promise<ReplayAnswer> {
  const before = savedForm(t, id);
  const reply = await thread.say(text);
  replyMatchesDiff(t, id, before, reply, text);
  if (savedForm(t, id) === before) noClaimWithoutUpdate(reply);
  expect(t.values(id).coaching_details ?? "", `"${text}": the bot's own reply was written into the Details`).not.toMatch(BOTS_OWN_WORDS);
  return reply;
}

export const NOV5_CODING3_CHAT_EDITS_CASES: ReplayCase[] = [
  {
    id: "nov5-coding3-these-details-answered-before-the-card",
    title:
      "(a) the coaching details the bot gave BEFORE the card: \"can you upate the draft with these details of coaching?\" → \"it didnt edit in the card\" → \"the details we just discussed!!!\" put them on Rowan's draft",
    report:
      'Manager, production (relayed 5 Nov 2026, both apps): "can you upate the draft with these details of coaching?" → "it didnt edit in the card" → "the details we just discussed!!!"',
    status: {
      open: "the Details stay empty: \"these details\" / \"the details we just discussed\" are read from the last reply (the card, then the bot's own no-change reply), never the earlier answer that held them",
    },
    // DETAILS_FROM_EARLIER_ANSWER_ENABLED (coding 6, 10 Nov 2026) hands the revision the earlier answer's details
    // (nov10-chat-edits-a-details-handed-to-the-revision); the pack's revision stand-in writes nothing, so what is SAVED
    // stays open here even with the fix: the live model writes what it is handed.
    fixFlags: ["DETAILS_FROM_EARLIER_ANSWER_ENABLED"],
    fixStatus: { open: "the pack's revision stand-in writes nothing; the fix's effect is what the revision is handed (nov10-chat-edits-a-details-handed-to-the-revision)" },
    async run(t: T) {
      start(t);
      const thread = t.thread();
      t.modelSays(HOW_TO_ANSWER);
      await thread.say("how do i coach on the spray tan booth, when to press start session and when to press session complete?");
      t.modelSays(null);
      await thread.say("Create a coaching form for Rowan Kestrel");
      expect(thread.proposal, "no Coaching Form card for Rowan Kestrel").toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      const id = await thread.create();
      for (const turn of ["can you upate the draft with these details of coaching?", "it didnt edit in the card", "the details we just discussed!!!"]) {
        await onDraft(t, thread, id, turn);
      }
      const details = t.values(id).coaching_details ?? "";
      for (const step of IN_THE_ANSWER) {
        expect(details, `after "the details we just discussed!!!" the Details do not hold the coaching details discussed before the card (${step})`).toMatch(step);
      }
    },
  },
  {
    id: "nov5-coding3-account-before-the-request-reaches-the-draft",
    title: "the account she gave before \"Create a coaching form.\" — shown on the card as its Observation — is what the draft is written from",
    report:
      'Manager, production (relayed 5 Nov 2026, both apps), the b17 mechanism with the account given first: "<name> marked <a thing> as <done> but <it wasn\'t>" → "Create a coaching form." → … → "can you upate the draft with these details of coaching?"',
    // Changed on purpose (10 Nov 2026): fixed in production by ACCOUNT_BEFORE_REQUEST_ENABLED, QA round 23.
    status: "fixed",
    // Fixed under ACCOUNT_BEFORE_REQUEST_ENABLED (coding 6, 10 Nov 2026): the account the card shows is cited, so Create hands it to the draft.
    fixFlags: ["ACCOUNT_BEFORE_REQUEST_ENABLED"],
    async run(t: T) {
      start(t);
      const thread = t.thread();
      let card: ReplayAnswer | null = null;
      await thread.say(ROWAN_DID);
      const asked = await thread.say("Create a coaching form.");
      // Asked "Is this for Rowan Kestrel?" (read from her account), she says yes.
      expect(asked.content, "the form request did not ask whether it is for Rowan Kestrel").toMatch(/Rowan Kestrel/);
      card = await thread.say("yes");
      expect(thread.proposal, "no Coaching Form card for Rowan Kestrel").toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      // The card says it has the account (what the manager saw before Create).
      expect(card?.content ?? "", "the card does not show her account").toMatch(SAID);
      /*
       * The live drafting model writes what it is handed; the stand-in writes
       * her account. The prompt assertion is the real check: had the prompt
       * not held it, the live model could not have written it.
       */
      t.draftWrites({ coaching_details: `Observed:\n${ROWAN_DID}` });
      const id = await thread.create();
      expect(t.draftPrompts().at(-1) ?? "", "the drafting model was not handed the account the card showed").toMatch(SAID);
      await onDraft(t, thread, id, "can you upate the draft with these details of coaching?");
      expect(t.values(id).coaching_details ?? "", "the draft does not say what Rowan did").toMatch(SAID);
    },
  },
  {
    id: "nov5-coding3-copy-paste-question-told-the-truth",
    title:
      "(b) \"i don't see the details updated in the draft card. Do i need to copy and paste it? …\" is answered truthfully, and the \"make that update\" it invites writes her account",
    report:
      'Manager, production (relayed 5 Nov 2026, both apps): "i don\'t see the details updated in the draft card.  Do i need to copy and paste it?  or should it be automatically updating?"',
    status: {
      open: "the live answer \"It should update automatically — no copy-and-paste needed\" is sent unchanged with nothing written (the claim guard's phrase list misses it); past that, the \"make that update\" the honest reply invites writes nothing",
    },
    async run(t: T) {
      start(t);
      const thread = t.thread();
      for (const turn of ["Create a coaching form.", "Rowan", "yes"]) await thread.say(turn);
      expect(thread.proposal, "no Coaching Form card for Rowan Kestrel").toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      const id = await thread.create();
      await onDraft(t, thread, id, ROWAN_DID);
      // What the live answering model said to (b) (the sibling app's live check, 31 Oct 2026, `form-content-turn.ts`).
      t.modelSays("It should update automatically — no copy-and-paste needed. The details are on the draft card.");
      const asked = await onDraft(
        t,
        thread,
        id,
        "i don't see the details updated in the draft card.  Do i need to copy and paste it?  or should it be automatically updating?",
      );
      t.modelSays(null);
      // Written by now: the truthful answer needs nothing more.
      if (SAID.test(t.values(id).coaching_details ?? "")) return;
      expect(asked.content, "the reply to (b) says it updates by itself though nothing was written").not.toMatch(
        /no copy[- ]?(?:and[- ])?paste needed|updates? automatically|details are on the draft/i,
      );
      // Her next turn in the report: what the reply invites.
      await onDraft(t, thread, id, "make that update");
      expect(t.values(id).coaching_details ?? "", 'after "make that update" the draft does not say what Rowan did').toMatch(SAID);
    },
  },
];

/*
 * DETAILS_FROM_EARLIER_ANSWER_ENABLED (coding 6, 10 Nov 2026): chat-edits (a) by what the revision model is HANDED. The
 * stand-in revision writes nothing, and a scripted write is accepted whatever the turn asked, so the invariant is the
 * request the revision gets: "the details we just discussed!!!" hands it the coaching details of the answer before the
 * card — never the app's own card or "I haven't changed …".
 */
export const NOV10_CHAT_EDITS_A_CASES: ReplayCase[] = [
  {
    id: "nov10-chat-edits-a-details-handed-to-the-revision",
    title: "(a) \"the details we just discussed!!!\" hands the revision the coaching details the app gave before the card, never its own card or no-change reply",
    report:
      'Manager, production (relayed 5 Nov 2026, both apps): "can you upate the draft with these details of coaching?" → "it didnt edit in the card" → "the details we just discussed!!!"',
    // Changed on purpose (10 Nov 2026): fixed in production by DETAILS_FROM_EARLIER_ANSWER_ENABLED, QA round 23.
    status: "fixed",
    fixFlags: ["DETAILS_FROM_EARLIER_ANSWER_ENABLED"],
    async run(t: T) {
      start(t);
      const thread = t.thread();
      t.modelSays(HOW_TO_ANSWER);
      await thread.say("how do i coach on the spray tan booth, when to press start session and when to press session complete?");
      t.modelSays(null);
      await thread.say("Create a coaching form for Rowan Kestrel");
      const id = await thread.create();
      for (const turn of ["can you upate the draft with these details of coaching?", "it didnt edit in the card"]) await onDraft(t, thread, id, turn);
      const before = t.revisionPrompts!().length;
      await onDraft(t, thread, id, "the details we just discussed!!!");
      const asked = t.revisionPrompts!().slice(before).join("\n");
      const change = /THE CHANGE THE MANAGER IS ASKING FOR NOW:([\s\S]*)/.exec(asked)?.[1] ?? "";
      for (const step of IN_THE_ANSWER) expect(change, `the revision was not handed the details discussed before the card (${step}):\n${change.slice(0, 300)}`).toMatch(step);
      expect(change, "the revision was handed the app's own reply").not.toMatch(BOTS_OWN_WORDS);
    },
  },
  /*
   * Ported from Ask Bubbles (Gate-Bubbles-4, 12 Nov 2026): nov7-refusal-bub-didnt-edit's turn 5 with
   * DETAILS_FROM_EARLIER_ANSWER on, as it is in production here. No earlier content answer is in the chat, and the turn
   * went to the free chat model (live there, 30 Oct: "Updating the draft now", nothing written). It now reads as with the
   * flag off: the revision is asked, and the reply says honestly that nothing changed. The person is invented.
   */
  {
    id: "nov12-details-from-earlier-answer-none-found",
    title: "\"can you upate the draft with these details of coaching?\" with no earlier content answer: the revision is asked, never the free chat model",
    report: "Ported from Ask Bubbles (Gate-Bubbles-4, 12 Nov 2026): the turn went to the free chat model with nothing to write",
    status: "fixed",
    async run(t: ReplayContext) {
      t.directory(REFUSAL_ROSTER);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("Create a coaching form.");
      await thread.say("Oswin");
      await thread.say("yes");
      await thread.create();
      await thread.say("spray tan booth, when to reset it and when to restock the solution");
      const before = t.calls();
      const fifth = await thread.say("can you upate the draft with these details of coaching?");
      const after = t.calls();
      expect(after.chat - before.chat, `turn 5 went to the free chat model:\n${fifth.content}`).toBe(0);
      expect(after.revision - before.revision, "turn 5 never reached the revision").toBe(1);
      expect(fifth.content, fifth.content).not.toMatch(/Updating the draft now/i);
    },
  },
];
