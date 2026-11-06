import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE FINAL REPLY AGREES WITH THE FINAL CARD (QA for Pau, 5 Nov 2026, "go")
 * ============================================================================
 *
 * REPLY_MATCHES_CARD_ENABLED, the last step of the turn. Each case is one of
 * today's contradictions, in the manager's words from the reports (R3/R5/R7,
 * the street placeholder, the off-roster "Name:" reply), with invented people;
 * each asserts one invariant on the real route: the final reply agrees with
 * the final card.
 *
 *   - no employee on the card: the reply never says it has the employee or
 *     that the draft is ready, names nobody as the employee, and asks who (or
 *     asks to choose / confirm a roster person);
 *   - an employee on the card: it never asks who;
 *   - one policy: no manual citation line for a section other than the card's.
 *
 * The flip's flags are on inside every case (where these contradictions
 * appeared); the cases do not depend on production's flags.
 */

const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
});

const IGNATIUS = person("e-ignatius-wexlerby", "Ignatius", "Wexlerby");
const CORWIN = person("e-corwin-hale", "Corwin", "Hale");

const FLIP = ["FORM_NAME_FROM_ROSTER_ENABLED", "CA_SALES_POLICY_ENABLED", "CHAT_GLOSSARY_ENABLED"];
const FIX = "REPLY_MATCHES_CARD_ENABLED";
const REPORT = "QA for Pau, 5 Nov 2026: the final reply must agree with the final card";

// "1. The employee's full name — or tell me it's for the whole team." asks who too.
const ASKS = /Who is this (?:\*\*[^*]+\*\* |form )?for\?|Did you mean|Which of them|Is this for \*\*|\bthe employee['’]s full name\b/i;
const CLAIMS = /Everything I need is here|I have the employee|Create the draft here when you're ready/i;
const MANUAL = /^\s*(?:[-*]\s*)?\**([^*\n,]+?)\**(?:\s+Policy)?,\s*JBA Policy Manual\b/i;

function heading(text: string): string {
  return text.replace(/\s+policy$/i, "").trim().toLowerCase();
}

/** The invariant: the reply says what the card says. `typed` are the request's words for the person. */
function agrees(reply: ReplayAnswer, employee: string | null, typed: readonly string[]): void {
  if (!employee) {
    expect(reply.content, `an empty card's reply claims the employee:\n${reply.content}`).not.toMatch(CLAIMS);
    expect(reply.content, `an empty card's reply does not ask who:\n${reply.content}`).toMatch(ASKS);
    const said = reply.content
      .split("\n")
      .filter((line) => !/I couldn['’]t find \*\*|Is this for \*\*|Did you mean|Which of them/.test(line))
      .join("\n");
    for (const word of typed) expect(said, `an empty card's reply names "${word}":\n${reply.content}`).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
  } else {
    expect(reply.content, `a card for ${employee} asks who:\n${reply.content}`).not.toMatch(/Who is this (?:\*\*[^*]+\*\* |form )?for\?/i);
  }
  const cited = reply.content.split("\n").map((line) => MANUAL.exec(line)?.[1]).filter((value): value is string => Boolean(value));
  expect(new Set(cited.map(heading)).size, `more than one policy cited:\n${reply.content}`).toBeLessThanOrEqual(1);
}

function withFlip(run: ReplayCase["run"]): ReplayCase["run"] {
  return async (t) => {
    for (const flag of FLIP) vi.stubEnv(flag, "true");
    try {
      await run(t);
    } finally {
      vi.unstubAllEnvs();
    }
  };
}

async function said(t: Parameters<ReplayCase["run"]>[0], ...turns: string[]) {
  vi.setSystemTime(new Date("2026-11-03T16:00:00Z"));
  t.directory([...STAFF, IGNATIUS, CORWIN]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  let reply: ReplayAnswer | undefined;
  for (const turn of turns) reply = await thread.say(turn);
  return { reply: reply!, employee: thread.proposal?.employeeName ?? null };
}

export const NOV5_REPLY_MATCHES_CARD_CASES: ReplayCase[] = [
  {
    id: "nov5-reply-card-r3-typo-action-plan",
    title: "R3: \"create a CA for Ignatius Wexlarby …\" (one letter wrong): whatever the card, the reply agrees with it (never the Action plan naming him beside an empty card)",
    report: `${REPORT}; R3 (QA's testers): the card emptied, the Action plan "with Ignatius", then "Who is this form for?"`,
    status: { open: "the empty card's Action plan names Ignatius" },
    fixFlags: [FIX],
    run: withFlip(async (t) => {
      const { reply, employee } = await said(t, "create a CA for Ignatius Wexlarby, he was 40 minutes late opening the salon on 11/2. action plan: Ignatius will be on time for every opening shift");
      agrees(reply, employee, ["Ignatius", "Wexlarby"]);
    }),
  },
  {
    id: "nov5-reply-card-off-roster-name-line",
    title: "off roster: \"I need a coaching form for Zebulon Marchbanks. Name: Zebulon Marchbanks. …\": the empty card's reply never says it has the employee, names nobody, and asks who",
    report: `${REPORT}; QA's testers: "Name: <B>" and "I have the employee" while the card is empty`,
    status: { open: "the empty card's reply says \"Everything I need is here … I have the employee and the salon\"" },
    fixFlags: [FIX],
    run: withFlip(async (t) => {
      const { reply, employee } = await said(t, "I need a coaching form for Zebulon Marchbanks. Name: Zebulon Marchbanks. He did not restock the lotion shelves before close on 11/2. Action plan: Zebulon will restock before every close");
      agrees(reply, employee, ["Zebulon", "Marchbanks"]);
    }),
  },
  {
    id: "nov5-reply-card-street-placeholder",
    title: "the street placeholder (the gate's regression 1): \"make a coaching form for <name>, she was late today\" after an address: the reply agrees with the card",
    report: `${REPORT}; ask-sunny#530 gate regression 1, held since #459`,
    status: "fixed",
    fixFlags: [FIX],
    run: withFlip(async (t) => {
      const { reply, employee } = await said(t, "coaching form for 123 Main Street", "make a coaching form for <name>, she was late today");
      agrees(reply, employee, []);
    }),
  },
  {
    id: "nov5-reply-card-roster-name-negative",
    title: "negative control: \"create a CA for Corwin Hale …\" (a roster name): the card is his and the reply agrees, unchanged",
    report: `${REPORT}, negative control`,
    status: "fixed",
    fixFlags: [FIX],
    run: withFlip(async (t) => {
      const { reply, employee } = await said(t, "create a CA for Corwin Hale, he was 40 minutes late opening the salon on 11/2. action plan: Corwin will be on time for every opening shift");
      expect(employee, `no card for Corwin Hale:\n${reply.content}`).toBe("Corwin Hale");
      agrees(reply, employee, []);
    }),
  },
];
