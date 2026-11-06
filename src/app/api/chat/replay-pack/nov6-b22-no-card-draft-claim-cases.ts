import { expect } from "vitest";

import { STAFF, KEARNEY, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * B22-2: NO CARD, NO CLAIM THAT A DRAFT IS OPEN (QA, 25 Oct 2026; rebuilt 6 Nov 2026)
 * ============================================================================
 *
 * QA B22-2: with a Corrective Action card open for one employee, the manager
 * typed "now one for Test Employee Two, Tanning Consultant, late today" and the
 * reply said "A new Corrective Action Form draft is open for Test Employee Two
 * … press Finalize on the card", with no card and no draft. The answering
 * model's text is scripted with that reply (`modelSays`); people are the
 * pack's invented staff. NO_CARD_DRAFT_CLAIM_ENABLED (default off) is the fix
 * (`lib/ai/no-card-draft-claim.ts`); it rebuilds the unmerged #233.
 *
 * Whether the live model still writes this sentence is QA's production
 * report; with production's flags the route passes it through unchanged.
 */

type T = ReplayContext;

const FIX = ["NO_CARD_DRAFT_CLAIM_ENABLED"];
const REPORT =
  'QA B22-2, 25 Oct 2026: "now one for Test Employee Two, Tanning Consultant, late today" → "A new Corrective Action Form draft is open for Test Employee Two … press Finalize on the card", with no card';

/** QA's reply, with the pack's invented employee. */
const PHANTOM =
  "A new Corrective Action Form draft is open for Remy Calder, Tanning Consultant, for arriving late on today's date. Look it over, and when it reads right, press Finalize on the card.\n\nLate arrivals are recorded as an attendance concern.";

/** The invariant: a reply with no card never says a draft is open for the new person, nor to use the card. */
function noPhantomDraft(reply: ReplayAnswer): void {
  expect(reply.content.trim(), "an empty reply").not.toBe("");
  if (reply.formProposal || reply.formOpened || reply.formUpdate) return;
  expect(reply.content, `claims a draft is open with no card:\n${reply.content}`).not.toMatch(/draft is open for remy calder/i);
  expect(reply.content, `press Finalize on a card that is not there:\n${reply.content}`).not.toMatch(/press Finalize on the card/i);
}

/** Marnie Holloway's CA, created: the card on screen before the B22-2 turn. */
async function withOpenDraft(t: T) {
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say("create a corrective action for Marnie Holloway, late today");
  t.draftWrites({});
  await thread.create();
  return thread;
}

function b22(id: string, turn: string, status: ReplayCase["status"]): ReplayCase {
  return {
    id,
    title: `B22-2: "${turn}" with the model claiming a new draft, no card: no claim that a draft is open`,
    report: REPORT,
    status,
    fixFlags: FIX,
    async run(t) {
      const thread = await withOpenDraft(t);
      t.modelSays(PHANTOM);
      noPhantomDraft(await thread.say(turn));
    },
  };
}

export const NOV6_B22_NO_CARD_DRAFT_CLAIM_CASES: ReplayCase[] = [
  /*
   * QA's turn in sentence case. Holds today only because a card comes back — for the open draft's employee, not
   * the newly named one (6 Nov 2026 audit). That wrong card is SAME_FORM_OTHER_PERSON's scope (#577), not this
   * guard's; once it is fixed, any card-less model reply here meets the guard.
   */
  b22("nov6-b22-2-no-card-draft-claim", "now one for Remy Calder, Tanning Consultant, late today", "fixed"),
  // As a question: the model answers it, and its phantom goes out with no card today (the B22-2 proof in this app).
  b22("nov6-b22-2-no-card-draft-claim-question", "what about remy calder, she was late too?", {
    open: "asked as a question, the model's phantom draft goes out with no card; NO_CARD_DRAFT_CLAIM_ENABLED",
  }),
  // Lowercase: a deterministic reply ("I haven't changed …") answers today; a guard that the fix keeps it so.
  b22("nov6-b22-2-no-card-draft-claim-lowercase", "now one for remy calder tanning consultant late today", "fixed"),
  {
    id: "nov6-b22-2-card-keeps-its-text",
    title: "B22-2 never-break: a reply that comes with a card keeps its text",
    report: `${REPORT} (never-break: the guard reads only replies without a card)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a corrective action for Remy Calder, late today");
      expect(reply.formProposal, "the request comes with a card").toBeTruthy();
      expect(reply.content, `a reply with a card was rewritten:\n${reply.content}`).not.toMatch(/I haven't created (?:a|a new) form\b/);
    },
  },
  {
    id: "nov6-b22-2-open-form-keeps-its-text",
    title: "B22-2 never-break: a reply about the form really open keeps its text",
    report: `${REPORT} (never-break: a true line about the open draft is kept)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = await withOpenDraft(t);
      const truth = "The draft for Marnie Holloway is open on the card above. When it reads right, press Finalize on the card.";
      t.modelSays(truth);
      const reply = await thread.say("is it ready to go?");
      expect(reply.content, `a true line about the open draft was rewritten:\n${reply.content}`).toContain(truth);
    },
  },
];
