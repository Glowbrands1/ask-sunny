import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "NOW ONE FOR <B> …" GETS <B>'S OWN CARD (QA B21-4, rebuilt 6 Nov 2026)
 * ============================================================================
 *
 * QA live B21-4, 25 Oct 2026: after a Corrective Action for Test Employee,
 * "now one for Test Employee Two at Lawrence for being late on 10-20-26" →
 * "Redrafted the Corrective Action Form for Test Employee…", and no card for
 * Test Employee Two (#224, never merged). The old-PR audit (6 Nov 2026) ran
 * the same words with production's flags, 24/24 failing:
 *
 *   - card on screen: the card stays <A>'s, and <B>'s "late on 10-20-26" turn
 *     is added to <A>'s card sources — <B>'s incident would go onto <A>'s form;
 *   - after Create: no card for <B>, and the reply says "I haven't changed the
 *     Corrective Action Form for <A>".
 *
 * Wanted (SAME_REQUEST_OTHER_PERSON_ENABLED; #592's DIFFERENT_EMPLOYEE_NEW_FORM was never merged): <B> gets their own card, built
 * from <B>'s turn only; <A>'s card or form is unchanged.
 *
 * QA's own placeholder names "Test Employee" / "Test Employee Two" are kept
 * (they are nobody); every other person is invented: Rory Vance, Mara Quell,
 * Odile Brannock, Caspian Drummet.
 *
 * Never-break cases, with the flag on: "now one for <A> again" is <A>'s; a
 * turn naming <B> with no account is a copy of <A>'s request (the same flag's
 * "the same thing for <B>"); an account that mentions a coworker stays <A>'s.
 */

type T = ReplayContext;

const SALON = "loc-0309";
const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: [SALON],
  positionName: "Tanning Consultant",
});

const TEST_EMPLOYEE = person("e-diffemp-te", "Test", "Employee");
const TEST_EMPLOYEE_TWO = person("e-diffemp-te2", "Test", "Employee Two");
const RORY = person("e-diffemp-rory-vance", "Rory", "Vance");
const MARA = person("e-diffemp-mara-quell", "Mara", "Quell");
const ODILE = person("e-diffemp-odile-brannock", "Odile", "Brannock");
const CASPIAN = person("e-diffemp-caspian-drummet", "Caspian", "Drummet");

/*
 * coding 6, 10 Nov 2026: brought over from #592 (never merged) at QA's request; the fix is
 * SAME_REQUEST_OTHER_PERSON_ENABLED (#738), which reads "now one for <B> <B's account>" as <B>'s own request.
 */
const FLAG = "SAME_REQUEST_OTHER_PERSON_ENABLED";
const REPORT = 'QA live B21-4, 25 Oct 2026 (#224; the old-PR audit, 6 Nov 2026, 24/24 failing with production\'s flags): "now one for Test Employee Two at Lawrence for being late on 10-20-26"';

function start(t: T) {
  vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
  t.directory([...STAFF, TEST_EMPLOYEE, TEST_EMPLOYEE_TWO, RORY, MARA, ODILE, CASPIAN]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const casings = (s: string) =>
  [
    ["lower", s.toLowerCase()],
    ["sentence", s[0]!.toUpperCase() + s.slice(1)],
    ["caps", s.toUpperCase()],
  ] as const;

/** The card's draft sources (the pack's answer type leaves them out). */
function sources(card: ReplayAnswer["formProposal"] | null | undefined): readonly string[] {
  return (card as { sourceMessageIds?: readonly string[] } | null | undefined)?.sourceMessageIds ?? [];
}

/** What the drafting model was handed as the manager's account, on the last Create. */
function lastDescribed(t: T): string {
  return (t.draftPrompts().at(-1) ?? "").split("WHAT THE MANAGER DESCRIBED:")[1] ?? "";
}

interface Wording {
  readonly key: string;
  /** A's request, turn 1. */
  readonly first: string;
  readonly a: string;
  readonly b: string;
  /** B's request, as typed (cased below). */
  readonly text: string;
  /** What the stand-in reading returns for B's turn (QA's live reading named B). */
  readonly reading?: Record<string, unknown>;
}

const WORDINGS: readonly Wording[] = [
  {
    key: "qa",
    first: "I need a corrective action for Test Employee, she was late opening the salon on Monday",
    a: "Test Employee",
    b: "Test Employee Two",
    text: "now one for Test Employee Two at Lawrence for being late on 10-20-26",
  },
  {
    key: "qa-nosalon",
    first: "I need a corrective action for Test Employee, she was late opening the salon on Monday",
    a: "Test Employee",
    b: "Test Employee Two",
    text: "now one for Test Employee Two for being late on 10-20-26",
  },
  {
    key: "distinct",
    first: "I need a corrective action for Rory Vance, she was late opening the salon on Monday",
    a: "Rory Vance",
    b: "Mara Quell",
    text: "now one for Mara Quell for being late on 10-20-26",
  },
  {
    key: "distinct-read",
    first: "I need a corrective action for Odile Brannock, she was late opening the salon on Monday",
    a: "Odile Brannock",
    b: "Caspian Drummet",
    text: "now one for Caspian Drummet for being late on 10-20-26",
    reading: { employeeName: "Caspian Drummet" },
  },
];

const OTHER_EMPLOYEE: ReplayCase[] = [];
for (const wording of WORDINGS) {
  for (const [casing, text] of casings(wording.text)) {
    for (const created of [false, true]) {
      OTHER_EMPLOYEE.push({
        id: `nov6-diffemp-${wording.key}-${created ? "after-create" : "card-on-screen"}-${casing}`,
        title: `${created ? `with ${wording.a}'s CA created and open` : `with ${wording.a}'s CA card on screen`}, "${text}" — ${wording.b}'s own card from that turn only; ${wording.a}'s ${created ? "form" : "card"} unchanged`,
        report: `${REPORT}; ${wording.key}, ${casing}, ${created ? "after Create" : "card on screen"}`,
        // Changed on purpose (10 Nov 2026): fixed in production by SAME_REQUEST_OTHER_PERSON_ENABLED, QA round 19; it now holds with production's flags.
        status: "fixed",
        fixFlags: [FLAG],
        async run(t) {
          const thread = start(t);
          await thread.say(wording.first);
          const aCard = thread.proposal;
          expect(aCard, `turn 1 made no CA card for ${wording.a}`).toMatchObject({ templateKey: "dpoa", employeeName: wording.a });
          const aSources = [...sources(aCard)];
          let first: string | null = null;
          let before = "";
          if (created) {
            t.draftWrites({ observation: `Observed:\n${wording.a} opened the salon late on Monday.` });
            first = await thread.create();
            before = JSON.stringify({ values: t.values(first), checked: t.checked(first) });
          }
          const reply = await thread.say(text, wording.reading);
          expect(reply.content, `redrafted ${wording.a}'s form`).not.toMatch(/redrafted/i);
          expect(reply.formUpdate?.instanceId ?? null, `${wording.a}'s form was written over`).toBeNull();
          expect(reply.formProposal, `no card for ${wording.b}:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: wording.b });
          // B's card is built from B's turn only: none of A's turns are its sources.
          const bSources = sources(reply.formProposal);
          expect(bSources.filter((id) => aSources.includes(id)), `${wording.a}'s turns are on ${wording.b}'s card`).toEqual([]);
          expect(reply.content, `${wording.a} is on ${wording.b}'s card`).not.toMatch(new RegExp(`\\b${wording.a}\\b(?! Two)`, "i"));
          if (first) {
            expect(JSON.stringify({ values: t.values(first), checked: t.checked(first) }), `${wording.a}'s form changed`).toBe(before);
          } else {
            // A's card (the one on screen before) is not changed by B's turn: its own sources are as they were.
            expect(sources(aCard), `${wording.a}'s card changed`).toEqual(aSources);
          }
          t.draftWrites({ observation: `Observed:\n${wording.b} was late on 10/20/2026.` });
          const second = await thread.create();
          if (first) expect(second, `${wording.b}'s card reopened ${wording.a}'s form`).not.toBe(first);
          expect(t.values(second).employee_name ?? "", `${wording.b}'s form names the wrong person`).toBe(wording.b);
          const described = lastDescribed(t);
          expect(described, `${wording.a}'s Monday late opening was handed to the drafting model for ${wording.b}`).not.toMatch(/opening the salon on monday/i);
          expect(described, `${wording.b}'s own account is not in the drafting notes`).toMatch(/10-20-26/);
          if (first) expect(JSON.stringify({ values: t.values(first), checked: t.checked(first) }), `${wording.a}'s form changed at ${wording.b}'s Create`).toBe(before);
        },
      });
    }
  }
}

/* ------------------------------------------------------------------ never-break -- */

const GUARDS: ReplayCase[] = [];
for (const created of [false, true]) {
  const state = created ? "after-create" : "card-on-screen";
  GUARDS.push(
    {
      id: `nov6-diffemp-guard-same-person-again-${state}`,
      title: `guard: ${created ? "with Rory's CA created" : "with Rory's CA card on screen"}, "now one for Rory Vance again for being late on 10-20-26" — never a card for anybody but Rory`,
      report: `${REPORT}; the same person asked for again (never-break)`,
      status: "fixed",
      fixFlags: [FLAG],
      async run(t) {
        const thread = start(t);
        await thread.say("I need a corrective action for Rory Vance, she was late opening the salon on Monday");
        expect(thread.proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Rory Vance" });
        let first: string | null = null;
        let before = "";
        if (created) {
          t.draftWrites({ observation: "Observed:\nRory Vance opened the salon late on Monday." });
          first = await thread.create();
          before = JSON.stringify(t.values(first));
        }
        const reply = await thread.say("now one for Rory Vance again for being late on 10-20-26");
        expect(reply.formProposal?.employeeName ?? "Rory Vance", `a card for somebody else:\n${reply.content}`).toBe("Rory Vance");
        if (first && reply.formUpdate?.instanceId !== first) expect(JSON.stringify(t.values(first))).toBe(before);
      },
    },
    {
      id: `nov6-diffemp-guard-no-account-stays-same-form-${state}`,
      title: `guard: ${created ? "with Rory's CA created" : "with Rory's CA card on screen"}, "Can you do the same thing for Mara Quell but switch it to a written" (no account) — coding 3's copy of Rory's, never a card from the request sentence alone`,
      report: `${REPORT}; a turn naming <B> with no account is a copy of <A>'s request (never-break)`,
      // Changed on purpose (10 Nov 2026): fixed in production by SAME_REQUEST_OTHER_PERSON_ENABLED, QA round 19; it now holds with production's flags.
      status: "fixed",
      fixFlags: [FLAG],
      async run(t) {
        const thread = start(t);
        await thread.say("I need a verbal corrective action for Rory Vance, she was late opening the salon on Monday");
        expect(thread.proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Rory Vance" });
        if (created) {
          t.draftWrites({ observation: "Observed:\nRory Vance opened the salon late on Monday." });
          await thread.create();
        }
        const reply = await thread.say("Can you do the same thing for Mara Quell but switch it to a written");
        expect(reply.formProposal, `no card for Mara Quell:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Mara Quell" });
        // "the same thing for <B>": Mara's card is read from Rory's request turns, names swapped — the late opening is on it.
        expect(reply.content, "Mara's card lost the late opening (not coding 3's copy)").toMatch(/late opening/i);
        expect(reply.content, "Rory is on Mara's card").not.toMatch(/rory|vance/i);
      },
    },
    {
      id: `nov6-diffemp-guard-coworker-in-account-${state}`,
      title: `guard: ${created ? "with Rory's CA created" : "with Rory's CA card on screen"}, "she was rude to Mara Quell when she reminded her" is more of Rory's account — never a card for Mara`,
      report: `${REPORT}; an account that mentions a coworker (never-break)`,
      status: "fixed",
      fixFlags: [FLAG],
      async run(t) {
        const thread = start(t);
        await thread.say("I need a corrective action for Rory Vance, she was late opening the salon on Monday");
        expect(thread.proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Rory Vance" });
        if (created) {
          t.draftWrites({ observation: "Observed:\nRory Vance opened the salon late on Monday." });
          await thread.create();
        }
        const reply = await thread.say("she was rude to Mara Quell when she reminded her");
        expect(reply.formProposal?.employeeName ?? "Rory Vance", `a card for Mara Quell:\n${reply.content}`).not.toBe("Mara Quell");
      },
    },
    {
      id: `nov6-diffemp-guard-ruled-out-${state}`,
      title: `guard: ${created ? "with Rory's CA created" : "with Rory's CA card on screen"}, "do not make one for Mara Quell, she was not late on 10-20-26" — never a card for Mara`,
      report: `${REPORT}; a person the manager ruled out (QA-6 on #224, never-break)`,
      status: "fixed",
      fixFlags: [FLAG],
      async run(t) {
        const thread = start(t);
        await thread.say("I need a corrective action for Rory Vance, she was late opening the salon on Monday");
        if (created) {
          t.draftWrites({ observation: "Observed:\nRory Vance opened the salon late on Monday." });
          await thread.create();
        }
        const reply = await thread.say("do not make one for Mara Quell, she was not late on 10-20-26");
        expect(reply.formProposal?.employeeName ?? "Rory Vance", `a card for Mara Quell:\n${reply.content}`).not.toBe("Mara Quell");
      },
    },
  );
}

export const NOV6_DIFFERENT_EMPLOYEE_NEW_FORM_CASES: readonly ReplayCase[] = [...OTHER_EMPLOYEE, ...GUARDS];
