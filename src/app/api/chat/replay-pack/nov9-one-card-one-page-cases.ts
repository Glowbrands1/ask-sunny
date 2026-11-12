import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * ONE CARD CITES ONE PAGE (QA, Sunny round 9 live, 9 Nov 2026)
 * ============================================================================
 *
 * QA's live check of round 9 (#710 and #711 on; the person invented and on no directory): for "left the front desk
 * unattended" and "cash drawer was short", the CA card's Policy line read "**Standards of Conduct** (page 13)" (the
 * manual's line for the incident, printed p.13, as Pau confirmed) and its citation line "Standards of Conduct Policy, JBA
 * Policy Manual p.12" (the heading's own page, from the slot model's saved heading). The Coaching card printed p.13 and
 * p.12. Some CA cards ("another corrective action for …", "for his cash drawer being short") had no citation line.
 * ONE_CARD_ONE_PAGE_ENABLED (`ai/form-card-slots.ts`). The slot model's heading is scripted as live ("Standards of
 * Conduct") in the cases that say so; the pack's manual (wording invented) also has the listed lines, on printed page 13.
 */
const CORWIN: DirectoryRow = {
  id: "e-corwin-ashgrove",
  firstName: "Corwin",
  lastName: "Ashgrove",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const LINES = {
  chunkIndex: 39.5,
  chunkId: "jba-39-5",
  locator: "Page 13 — Standards of Conduct",
  page: 14,
  content: "o Register / Bank shortages that are not explained\no Unapproved absence from the work area during a shift",
  section: "Standards of Conduct",
  printedPage: 13,
  sections: [],
};
const T1 = "create a corrective action for Corwin Ashgrove, he was late opening the salon on 11/2";
const FIX = ["ONE_CARD_ONE_PAGE_ENABLED"];
const REPORT = "QA, Sunny round 9 live (9 Nov 2026): \"Standards of Conduct (page 13)\" and \"… JBA Policy Manual p.12\" on one card";
// Was OPEN until QA round 34: "the card cites p.12 under a page-13 Policy line, or has no citation line".

/** Every page the card gives the Standards of Conduct. */
function conductPages(content: string): number[] {
  return [
    ...[...content.matchAll(/\*\*Standards of Conduct\*\* \(page (\d+)\)/g)].map((match) => Number(match[1])),
    ...[...content.matchAll(/^Standards of Conduct(?: Policy)?, JBA Policy Manual p\.(\d+)/gm)].map((match) => Number(match[1])),
  ];
}

async function card(t: ReplayContext, turns: readonly string[], model: boolean, formType = "Corrective Action Form") {
  vi.setSystemTime(new Date("2026-11-09T09:00:00Z"));
  t.directory([...STAFF, CORWIN]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([LINES]);
  const thread = t.thread();
  let reply = { content: "" };
  for (const [at, turn] of turns.entries()) {
    if (model && at === turns.length - 1) t.slotsRead({ employee: "Corwin Ashgrove", formType, formTurn: true, policyHeading: "Standards of Conduct" });
    reply = await thread.say(turn);
  }
  const pages = conductPages(reply.content);
  expect(new Set(pages), `more than one page, or none:\n${reply.content}`).toEqual(new Set([13]));
  expect(reply.content, `no citation line:\n${reply.content}`).toMatch(/^Standards of Conduct Policy, JBA Policy Manual p\.13$/m);
}

const CA: { id: string; turns: string[] }[] = [
  { id: "front-desk", turns: ["create a corrective action for Corwin Ashgrove, he left the front desk unattended on 11/6/26"] },
  { id: "cash-drawer", turns: ["create a corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3"] },
  { id: "another", turns: [T1, "I need another corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3"] },
  { id: "for-being-short", turns: ["I need another corrective action for Corwin Ashgrove for his cash drawer being short $20 on 11/3"] },
];

export const NOV9_ONE_CARD_ONE_PAGE_CASES: ReplayCase[] = [
  ...CA.flatMap(({ id, turns }) =>
    [false, true].map(
      (model): ReplayCase => ({
        id: `nov9-one-card-one-page-${id}${model ? "-model-heading" : ""}`,
        title: `"${turns.at(-1)}"${model ? " (the model also reads Standards of Conduct)" : ""}: the card cites the Standards of Conduct on page 13 only, with its citation line`,
        report: REPORT,
        // Changed on purpose (12 Nov 2026): fixed in production by ONE_CARD_ONE_PAGE, QA round 34. Was OPEN (see the note above).
        status: "fixed" as const,
        fixFlags: FIX,
        run: (t) => card(t, turns, model),
      }),
    ),
  ),
  {
    id: "nov9-one-card-one-page-coaching",
    title: "a Coaching card for \"he left the front desk unattended on 11/6/26\" (the model reads Standards of Conduct): p.13 only, never p.13 and p.12",
    report: REPORT,
    // Changed on purpose (12 Nov 2026): fixed in production by ONE_CARD_ONE_PAGE, QA round 34. Was OPEN ("the Coaching card prints p.13 and p.12").
    status: "fixed",
    fixFlags: FIX,
    run: (t) => card(t, ["create a coaching form for Corwin Ashgrove, he left the front desk unattended on 11/6/26"], true, "Coaching Form"),
  },
  {
    id: "nov9-one-card-one-page-late-opening",
    title: "negative: \"… he was late opening the salon on 11/2\": the Late Opening citation keeps its own page (p.15)",
    report: `${REPORT} (the condition)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-09T09:00:00Z"));
      t.directory([...STAFF, CORWIN]);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say(T1);
      expect(reply.content, `the Late Opening citation:\n${reply.content}`).toMatch(/^Late Opening Policy, JBA Policy Manual p\.15$/m);
    },
  },
];
