import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";

/**
 * ============================================================================
 * QA'S MSB CASE M5 (both apps, 5 Nov 2026): "YES" TO THE CORRECTIVE ACTION
 * OFFER KEEPS THE MANAGER'S ACCOUNT
 * ============================================================================
 *
 * The manager's exact wording (employee invented): "<name> did not follow
 * must see behaviors which violates standards of conduct policy" → the one
 * Corrective Action offer (`ca-offer.ts`) → "yes" → the card read "What
 * happened: The policy is Standards of Conduct" instead of the MSB shortfall
 * she described. `acceptedCaOffer` turns "yes" into the request the offer
 * accepts ("Create a Corrective Action Form for <name>. The policy is
 * Standards of Conduct."), and the card read that rewritten request as her
 * account (replayed here: "What happened: Create a Corrective Action Form for
 * policy is Standards of Conduct", and "Employee: <name>. The").
 *
 * FLAGS. The offer exists only with CA_SALES_POLICY_ENABLED, which is off in
 * production-flags.json today: with it off, "yes" makes no card at all. It
 * ships with the CA_SALES flip, so every case here stubs it on; the pack's
 * other flags stay production's. The tester's "What happened:" card is the
 * full remap's (FORM_FULL_REMAP_ENABLED, also off in production-flags.json):
 * the bug replays only with it on, so the M5 case stubs it too. With
 * CA_SALES_POLICY_ENABLED alone this app's card shows no account line and
 * never the rewritten request; that path is kept as a guard (fixed, with and
 * without the fix).
 *
 * Fixed behind CA_OFFER_KEEPS_ACCOUNT_ENABLED (`acceptedCaOfferTurn`, the
 * caller in `server-ask.ts`): the accepted yes is answered as the turn the
 * offer answered, her own words asked for as a Corrective Action Form, so the
 * card's account is read from what she said and never from the rewritten
 * request. When her turn makes no card (it held no account), the yes is the
 * employee the offer named, for that form — still no sentence of the app's.
 */

type T = ReplayContext;

const SALON = "loc-0309";

const NERISSA: DirectoryRow = {
  id: "e-nerissa-quellmont",
  firstName: "Nerissa",
  lastName: "Quellmont",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: [SALON],
  positionName: "Tanning Consultant",
};

const REPORT = "QA's MSB case M5, 5 Nov 2026";
const FIX = "CA_OFFER_KEEPS_ACCOUNT_ENABLED";
/** M5, verbatim but for the employee. */
const M5 = "Nerissa Quellmont did not follow must see behaviors which violates standards of conduct policy";
/** An offer with no account: the employee and the policy, nothing she did. */
const NO_ACCOUNT = "Nerissa Quellmont standards of conduct policy";
const OFFER = /\*\*Do you want a Corrective Action for Nerissa Quellmont\?\*\*[^\n]*\*\*Standards of Conduct\*\*/;
const ACCOUNT_LINE = /\*\*(?:What happened|Observation of Offense):?\*\*/i;
/** The offer's rewritten request ("Create a Corrective Action Form for <name>. The policy is <policy>."), or what is left of it. */
const REWRITTEN = /\bpolicy is Standards of Conduct\b|Create a Corrective Action Form/i;
const ASKS_WHAT = /what happened\?/i;

/**
 * CA_SALES_POLICY_ENABLED ships with the CA_SALES flip (off in
 * production-flags.json today): the offer exists only with it on.
 * FORM_FULL_REMAP_ENABLED (the tester's "What happened:" card) only where a
 * case says so.
 */
async function withOffer(t: T, remap: boolean, run: (thread: ReplayThread) => Promise<void>): Promise<void> {
  vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
  if (remap) vi.stubEnv("FORM_FULL_REMAP_ENABLED", "true");
  try {
    vi.setSystemTime(new Date("2026-11-05T15:30:00Z"));
    t.directory([...STAFF, NERISSA]);
    t.as("salon_director", KEARNEY);
    await run(t.thread());
  } finally {
    vi.unstubAllEnvs();
  }
}

function accountLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => ACCOUNT_LINE.test(line)) ?? "";
}

function policyLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*Policy:?\*\*/i.test(line)) ?? "";
}

/** M5's turns: her account, the one offer, "yes". */
async function m5(thread: ReplayThread): Promise<ReplayAnswer> {
  const offered = await thread.say(M5);
  expect(thread.proposal ?? null, `a card was made before "yes":\n${offered.content}`).toBeNull();
  expect(offered.content, `no Corrective Action offer:\n${offered.content}`).toMatch(OFFER);
  const card = await thread.say("yes");
  expect(thread.proposal, `"yes" made no Corrective Action card:\n${card.content}`).toMatchObject({ templateKey: "dpoa" });
  return card;
}

/** The card is for Nerissa Quellmont and cites the Standards of Conduct (the rewritten request also made the employee "Nerissa Quellmont. The"). */
function forHerCitingConduct(card: ReplayAnswer, thread: ReplayThread): void {
  expect(thread.proposal?.employeeName, `the card's employee:\n${card.content}`).toBe("Nerissa Quellmont");
  expect(policyLine(card), `the card does not cite the Standards of Conduct:\n${card.content}`).toMatch(/standards of conduct/i);
}

/** Her MSB words are the card's account; the rewritten request never is. */
function keepsHerAccount(card: ReplayAnswer): void {
  const happened = accountLine(card);
  expect(happened, `the card has no What happened / Observation line:\n${card.content}`).not.toBe("");
  expect(happened, `What happened is the offer's rewritten request, not her account:\n${happened}`).not.toMatch(REWRITTEN);
  expect(happened, `What happened does not hold the MSB shortfall she described:\n${happened}`).toMatch(/did not follow must see behaviors/i);
}

/**
 * No account was given: the card never shows the app's own sentence as one.
 * An account line, if any, holds only words she said (today's Observation
 * repeats her turn), or the card asks what happened.
 */
function inventsNoAccount(card: ReplayAnswer, thread: ReplayThread, said: string): void {
  expect(thread.proposal, `"yes" made no Corrective Action card for Nerissa Quellmont:\n${card.content}`).toMatchObject({ templateKey: "dpoa" });
  const happened = accountLine(card);
  expect(happened, `the card's account is the offer's rewritten request:\n${card.content}`).not.toMatch(REWRITTEN);
  if (!happened || ASKS_WHAT.test(card.content)) return;
  const herWords = new Set(said.toLowerCase().match(/[a-z']+/g) ?? []);
  const value = happened.replace(ACCOUNT_LINE, "").toLowerCase().match(/[a-z']+/g) ?? [];
  expect(value.filter((word) => !herWords.has(word)), `an account she never gave:\n${happened}`).toEqual([]);
}

export const NOV5_CODING3_CA_OFFER_ACCOUNT_CASES: ReplayCase[] = [
  {
    id: "nov5-coding3-ca-offer-yes-keeps-msb-account",
    title: "M5: \"<name> did not follow must see behaviors which violates standards of conduct policy\" → offer → \"yes\": the card's What happened is her MSB account, never \"The policy is Standards of Conduct\"; the Policy is still Standards of Conduct",
    report: `${REPORT}: "<name> did not follow must see behaviors which violates standards of conduct policy" → "Do you want a Corrective Action for <name>?" → "yes" → the card read "What happened: The policy is Standards of Conduct"`,
    /*
     * The tester's card: CA_SALES_POLICY_ENABLED (ships with the CA_SALES
     * flip) and FORM_FULL_REMAP_ENABLED (the "What happened:" card), both
     * stubbed on in the run.
     */
    status: { open: "with the CA_SALES flip and the full remap, What happened is the offer's rewritten request (\"Create a Corrective Action Form for policy is Standards of Conduct\"), not her MSB account" },
    fixFlags: [FIX],
    async run(t) {
      await withOffer(t, true, async (thread) => {
        const card = await m5(thread);
        keepsHerAccount(card);
        forHerCitingConduct(card, thread);
      });
    },
  },
  {
    id: "nov5-coding3-ca-offer-yes-keeps-msb-observation",
    title: "M5 on the Observation card (CA_SALES flip, no full remap): \"yes\" keeps her MSB account as the Observation of Offense, with and without the fix",
    report: `${REPORT}: the same turns on the card production shows once CA_SALES flips`,
    status: "fixed",
    fixFlags: [FIX],
    async run(t) {
      await withOffer(t, false, async (thread) => {
        const card = await m5(thread);
        forHerCitingConduct(card, thread);
        // This app's card shows no account line here; if it ever does, it is never the rewritten request.
        const happened = accountLine(card);
        if (happened) expect(happened, `the Observation is the rewritten request:\n${happened}`).not.toMatch(REWRITTEN);
      });
    },
  },
  {
    id: "nov5-coding3-ca-offer-yes-no-account",
    title: "negative control for M5: an offer that followed no account (\"<name> standards of conduct policy\"), accepted with \"yes\": a card, and no account invented from the offer's request",
    report: `${REPORT}, negative control: the offer can follow a turn that names only the employee and the policy`,
    status: "fixed",
    fixFlags: [FIX],
    async run(t) {
      await withOffer(t, false, async (thread) => {
        const offered = await thread.say(NO_ACCOUNT);
        expect(offered.content, `no Corrective Action offer:\n${offered.content}`).toMatch(OFFER);
        const card = await thread.say("yes");
        inventsNoAccount(card, thread, NO_ACCOUNT);
      });
    },
  },
  {
    id: "nov5-coding3-ca-offer-yes-no-account-remap",
    title: "negative control for M5 on the full remap's card: an offer that followed no account, accepted with \"yes\": What happened is never the offer's request",
    report: `${REPORT}, negative control on the "What happened:" card`,
    /*
     * STILL OPEN WITH THE FIX, for a reason that is not the offer's. With the
     * fix, her turn alone makes no card (it holds no account), so the yes is
     * answered as the employee the offer named, for a Corrective Action Form:
     * no sentence of the app's is read. The full remap's own no-account card
     * then writes "What happened: The employee is . Job title: Tanning
     * Consultant. It happened" — the same card a typed "Create a corrective
     * action for <name>" gets after this turn (replayed 5 Nov 2026). That is
     * the remap's account reader, not the offer.
     */
    status: { open: "with the CA_SALES flip and the full remap, What happened is \"Create a Corrective Action Form for policy is Standards of Conduct\"" },
    // QA's S1 (11 Nov 2026): REMAP_APP_LINES_NOT_ACCOUNT_ENABLED leaves the app's own lines out of the full remap's account read, so the
    // no-account card's What happened is no longer "The employee is . Job title: … It happened"; holds with both flags.
    fixFlags: [FIX, "REMAP_APP_LINES_NOT_ACCOUNT_ENABLED"],
    async run(t) {
      await withOffer(t, true, async (thread) => {
        const offered = await thread.say(NO_ACCOUNT);
        expect(offered.content, `no Corrective Action offer:\n${offered.content}`).toMatch(OFFER);
        const card = await thread.say("yes");
        inventsNoAccount(card, thread, NO_ACCOUNT);
      });
    },
  },
];
