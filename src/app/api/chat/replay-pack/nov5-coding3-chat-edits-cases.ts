import { expect } from "vitest";

import { KEARNEY, STAFF, noClaimWithoutUpdate, replyMatchesDiff, savedForm, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";

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
 * Invariants only: what is SAVED, what is CLAIMED, and what the drafting and
 * revision models are HANDED.
 *
 * WHAT THE REVISION IS HANDED IS THE CHECK (5 Nov 2026). The revision stand-in
 * writes whatever `revisionWrites` scripts, whatever it was handed, so a case
 * that scripts it and asserts only the saved form passes with any source. The
 * two item-1 cases assert on `revisionPrompts()`: the live model can write the
 * details only when it is handed them. Fixed behind
 * FORM_EDIT_SOURCE_TURN_ENABLED (`form-content-turn.ts` `sourceTurn`; the route
 * stamps `formReply` on replies about the open form, and the manager's turn
 * a reply did not write as `unwritten`).
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

/**
 * What a revision call was handed for THIS turn: the change it was asked for,
 * and the manager message just before it (the one "the details in my last
 * message" points to). Not the whole conversation, which the revision always
 * reads: her account, said earlier, is in every later prompt.
 */
function handedNow(prompt: string): string {
  const [said = "", change = ""] = prompt.split("THE CHANGE THE MANAGER IS ASKING FOR NOW:");
  const turns = (said.split("WHAT THE MANAGER HAS SAID IN THIS CONVERSATION:")[1] ?? "").trim().split("\n\n");
  return [turns.at(-2) ?? "", change.trim()].join("\n");
}

/** The MSB case's employee (invented). */
const SELA: DirectoryRow = { id: "e-sela", firstName: "Sela", lastName: "Brannock", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
/** The shortfall she described first, in the managers' MSB wording (`nov4-manager-msb-cases.ts`). */
const SHORTFALL = "Sela Brannock is not following her MSB. She was under in PPTA, LPSVA and Spa% for october.";

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
    fixFlags: ["FORM_EDIT_SOURCE_TURN_ENABLED"],
    async run(t: T) {
      start(t);
      const thread = t.thread();
      t.modelSays(HOW_TO_ANSWER);
      await thread.say("how do i coach on the spray tan booth, when to press start session and when to press session complete?");
      t.modelSays(null);
      await thread.say("Create a coaching form for Rowan Kestrel");
      expect(thread.proposal, "no Coaching Form card for Rowan Kestrel").toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      const id = await thread.create();
      /*
       * The stand-in writes nothing on any turn — the worst case, as in her
       * report — so "the details we just discussed!!!" must still be handed the
       * answer, never "it didnt edit in the card". This replaces the case's
       * first check (the saved Details hold the answer), which a scripted
       * stand-in passes whatever it is handed (5 Nov 2026).
       */
      for (const turn of ["can you upate the draft with these details of coaching?", "it didnt edit in the card", "the details we just discussed!!!"]) {
        const calls = t.revisionPrompts().length;
        await onDraft(t, thread, id, turn);
        if (turn === "it didnt edit in the card") continue;
        const handed = t.revisionPrompts().slice(calls).join("\n");
        for (const step of IN_THE_ANSWER) {
          expect(handed, `"${turn}": the revision was not handed the coaching details discussed before the card (${step})`).toMatch(step);
        }
        // Verbatim: the answer's "Start Session" is not rewritten to "begin Session".
        expect(handed, `"${turn}": the answer was not handed verbatim`).toMatch(/Press \*\*Start Session\*\*/);
      }
    },
  },
  {
    id: "nov5-coding3-account-before-the-request-reaches-the-draft",
    title: "the account she gave before \"Create a coaching form.\" — shown on the card as its Observation — is what the draft is written from",
    report:
      'Manager, production (relayed 5 Nov 2026, both apps), the b17 mechanism with the account given first: "<name> marked <a thing> as <done> but <it wasn\'t>" → "Create a coaching form." → … → "can you upate the draft with these details of coaching?"',
    status: {
      open: "the card shows her account as its Observation, but the drafting model is handed only \"Create a coaching form.\" and \"yes\" (the draft's turns start at the request)",
    },
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
    fixFlags: ["FORM_EDIT_SOURCE_TURN_ENABLED"],
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
      const calls = t.revisionPrompts().length;
      // The live model writes what it is handed; the stand-in writes her account. The check is what it was handed.
      t.revisionWrites({ coaching_details: ROWAN_DID });
      await onDraft(t, thread, id, "make that update");
      const handed = t.revisionPrompts().slice(calls).map(handedNow).join("\n");
      expect(handed, '"make that update" did not hand the revision her account').toMatch(SAID);
      expect(t.values(id).coaching_details ?? "", 'after "make that update" the draft does not say what Rowan did').toMatch(SAID);
    },
  },
  {
    id: "nov5-coding3-msb-yes-card-what-happened",
    title:
      "a CA after an MSB shortfall: she described the shortfall, the card was offered, she said \"yes\" — the card's What happened / Observation is the shortfall she described, never \"The policy is Standards of Conduct\"",
    report:
      'QA, relaying a tester\'s live chat (5 Nov 2026, both apps): the manager described an MSB / sales shortfall, the Corrective Action was offered, she said "yes", and the card read "What happened: The policy is Standards of Conduct" instead of the shortfall',
    /*
     * NOT ITEM 1'S ROOT CAUSE (replayed 5 Nov 2026). Before any form is open,
     * nothing reads a "previous answer". With production's flags the offer
     * does not exist (CA_SALES_POLICY_ENABLED is off), so "yes" makes no card.
     * The tester's card ("What happened:" is the full remap's card) replays with
     * CA_SALES_POLICY_ENABLED and FORM_FULL_REMAP_ENABLED on: "yes" is turned
     * into the request the offer accepts ("Create a Corrective Action Form for
     * <name>. The policy is Standards of Conduct.", `acceptedCaOffer` in
     * `lib/ai/ca-offer.ts`) and the remap reads that request as the account:
     * "What happened: Create a Corrective Action Form for policy is Standards
     * of Conduct". With CA_SALES_POLICY_ENABLED alone the Observation holds
     * her shortfall. No fixFlags: FORM_EDIT_SOURCE_TURN_ENABLED does not touch it.
     */
    status: {
      open: "with production's flags \"yes\" makes no card (no Corrective Action is offered: CA_SALES_POLICY_ENABLED is off); with the offer and the full remap on (the tester's card), What happened is the offer's own request, \"Create a Corrective Action Form for policy is Standards of Conduct\"",
    },
    async run(t: T) {
      t.directory([...STAFF, SELA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(SHORTFALL);
      const card = await thread.say("yes");
      expect(thread.proposal, `"yes" made no Corrective Action card for Sela Brannock:\n${card.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Sela Brannock" });
      const happened = card.content.split("\n").find((line) => /\*\*(?:What happened|Observation of Offense):?\*\*/i.test(line)) ?? "";
      expect(happened, `the card has no What happened / Observation line:\n${card.content}`).not.toBe("");
      expect(happened, `What happened is the offer's request, not her shortfall:\n${happened}`).not.toMatch(/\bpolicy is Standards of Conduct\b|Create a Corrective Action Form/i);
      expect(happened, `What happened does not hold the shortfall she described:\n${happened}`).toMatch(/PPTA|LPSVA|Spa%|\bMSB\b/i);
    },
  },
];
