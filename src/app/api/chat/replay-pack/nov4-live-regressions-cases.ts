import { expect } from "vitest";

import { KEARNEY, claimsFormChange, noClaimWithoutUpdate, replyMatchesDiff, savedForm, type ReplayAnswer, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";
import {
  CA_CHAIN,
  COACHING_CHAIN,
  COACHING_OPENING,
  DETAILS_AFTER,
  DETAILS_LANE,
  LIVE_ROSTER,
  NAME,
  NAME_WORDINGS,
  OBSERVATION_AFTER,
  at,
  nameRoster,
  type NameWording,
} from "./nov4-live-regressions-scenarios";

/**
 * ============================================================================
 * REGRESSION SET #1 — THE LIVE STEP B FAILURES (4 Nov 2026)
 * ============================================================================
 *
 * Ported from Ask Bubbles (c20e858, bb29452), the mechanism in this app's
 * setting. Step B (FORM_PATCH_REDUCER_ENABLED / FORM_REPLY_FROM_DIFF_ENABLED)
 * was flipped live in the sibling app and rolled back; QA's testers ran the
 * same chats here with the flags off. This is the set every later step must
 * pass. Production's flags have Step B OFF, so the cases describe what the
 * OLD path does today; the `-step-b` cases turn Step B on themselves to pin
 * its known failures. Test-only, no flag: `fixFlags: []` on every case until
 * a step claims one.
 *
 * The testers' exact turns, one each, in order, in a new chat, people
 * invented (on the directory under their opening names only: see
 * `LIVE_ROSTER`). The drafting and revision models are scripted to
 * reproduce the BASELINE (flags off) texts the testers saw
 * (`t.draftWrites`, `t.revisionWrites`). The turns are in
 * `nov4-live-regressions-scenarios.ts`, shared with the LIVE=1 script
 * (`evals/live-regressions.eval.ts`).
 *
 * Each chat is cut into prefixes: case k replays turns 1..k, holds the
 * invariants on every turn, and checks turn k's own outcome — so each turn
 * has its own status.
 *
 * INVARIANTS, on what is SAVED and what is CLAIMED:
 *   - the saved values match the reply (`replyMatchesDiff`);
 *   - no "Updated"/"Changed" without a saved change (`noClaimWithoutUpdate`);
 *   - the first name survives in every sentence that names her.
 */

type T = ReplayContext;

/** One turn on the open draft: no claim of a change the saved form does not show. */
async function turnOnDraft(t: T, thread: ReplayThread, id: string, text: string): Promise<{ reply: ReplayAnswer; changed: boolean }> {
  const before = savedForm(t, id);
  const reply = await thread.say(text);
  replyMatchesDiff(t, id, before, reply, text);
  noClaimWithoutUpdate(reply);
  return { reply, changed: savedForm(t, id) !== before };
}

/** The sentences (or lines) of a field that match `pattern`. */
function sentencesNaming(text: string, pattern: RegExp): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter((sentence) => pattern.test(sentence));
}

/** `first` survives: every sentence naming her surname carries the first name. */
function firstNameSurvives(text: string, first: string, surname: RegExp, field: string): void {
  for (const sentence of sentencesNaming(text, surname)) {
    expect(sentence, `${field}: "${first}" was dropped from a sentence naming her`).toMatch(new RegExp(`\\b${first}\\s`));
  }
}

/** Step B's two flags, turned on for one case's run only (and restored). */
const STEP_B_FLAGS = ["FORM_PATCH_REDUCER_ENABLED", "FORM_REPLY_FROM_DIFF_ENABLED"] as const;
async function withStepB(run: () => Promise<void>): Promise<void> {
  const saved = STEP_B_FLAGS.map((name) => [name, process.env[name]] as const);
  for (const name of STEP_B_FLAGS) process.env[name] = "true";
  try {
    await run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const REPORT = "QA's Step B regression set, 4 Nov 2026 (the testers' chats here, flags off), the tester's exact turns";

/* ---------------------------------------------------- the CA chat, T1–T6 -- */

/*
 * THE BASELINE TEXTS (flags off), which the scripted models reproduce
 * (`OBSERVATION_AFTER` in the scenarios file, shared with LIVE_DRY=1):
 *   T1 Create   "Observed: Jane Doe was late to open on October 20, 2026. Expectation: Jane is expected to arrive on time…"
 *   T2          "Jane Doe-Smith was late to open …" (employee_name stays "Jane Doe": Doe-Smith is not on the directory)
 *   T3          "… was late to open on October 20, 2026. Jane was also late on Tuesday. Expectation: …"
 *   T4–T6       the sibling app's further turns, values valid here: "Daily stats show 3 of 4 shifts on time."; no
 *               revision text for the position; "Jane must also practice the sanitizing checklist every shift."
 */
/** Turn k's own outcome (1-based), on the saved values and the reply. */
const CA_TURN_CHECK: Readonly<Record<number, (values: Record<string, string>, reply: ReplayAnswer, changed: boolean) => void>> = {
  1: (values) => {
    expect(values.employee_name, "the Employee Name at Create").toBe("Jane Doe");
    expect(values.observation ?? "", "the created Observation does not name Jane Doe").toMatch(/\bJane Doe\b/);
  },
  2: (values) => {
    expect(values.observation ?? "", "the Observation does not carry Doe-Smith").toMatch(/\bJane Doe-Smith\b/);
  },
  3: (values) => {
    expect(values.observation ?? "", "Tuesday never reached the Observation").toMatch(/also late on Tuesday/i);
  },
  4: (values, reply) => {
    const placed = /3 of 4 shifts on time/i.test(JSON.stringify(values));
    const asks = /\?/.test(reply.content) && /\bwhich\b|\bwhere\b/i.test(reply.content);
    expect(placed || asks, `the figure was neither placed nor asked about:\n${reply.content}`).toBe(true);
  },
  5: (values, reply) => {
    // "Tanning Consultant" is a title this app has; either it is saved, or nothing claims it was.
    const claimsTitle = reply.content.split("\n").some((line) => /\b(?:updated|changed|now reads)\b/i.test(line) && /\b(?:job title|position)\b/i.test(line) && !/\b(?:not|n't|cannot|can't)\b/i.test(line));
    if (claimsTitle || reply.formUpdate?.updated.includes("job_title")) expect(values.job_title, "the reply says the position changed and it did not").toMatch(/^Tanning Consultant/);
  },
  6: (values) => {
    expect(values.observation ?? "", "the sanitizing-checklist sentence is not on the form").toMatch(/practice the sanitizing checklist every shift/i);
  },
};

async function caChat(t: T, upTo: number): Promise<void> {
  t.directory(LIVE_ROSTER);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(CA_CHAIN[0]);
  expect(thread.proposal, "T1 made no card for Jane Doe").toMatchObject({ templateKey: "dpoa", employeeName: "Jane Doe" });
  t.draftWrites({ observation: OBSERVATION_AFTER[0]! });
  const id = await thread.create();
  firstNameSurvives(t.values(id).observation ?? "", "Jane", /\bdoe\b/i, "T1");
  if (upTo === 1) return CA_TURN_CHECK[1]!(t.values(id), { content: "" }, true);
  for (let turn = 2; turn <= upTo; turn += 1) {
    const written = OBSERVATION_AFTER[turn - 1];
    t.revisionWrites(written ? { observation: written } : {});
    const { reply, changed } = await turnOnDraft(t, thread, id, CA_CHAIN[turn - 1]!);
    firstNameSurvives(t.values(id).observation ?? "", "Jane", /\bdoe\b/i, `T${turn}`);
    if (turn === upTo) CA_TURN_CHECK[turn]!(t.values(id), reply, changed);
  }
}

/** Today's status of each prefix (production flags), from running the pack on 4 Nov 2026. */
const CA_OPEN: Readonly<Record<number, string>> = {};

const CA_CASES: readonly ReplayCase[] = CA_CHAIN.map((said, index): ReplayCase => {
  const turn = index + 1;
  const open = CA_OPEN[turn];
  return {
    id: `nov4-live-ca-t${turn}`,
    title: `CA chat T${turn} "${said}"${turn === 1 ? " → Create" : ""} — the old path`,
    report: `${REPORT}: T${turn} "${said}"`,
    status: open ? { open } : "fixed",
    fixFlags: [],
    run: (t) => caChat(t, turn),
  };
});

/*
 * STEP B'S KNOWN FAILURES, for the new design to fix. The pack has no
 * expected-fail for a fixFlags run (it must hold), so each turns Step B's
 * flags on itself; a known failure is `open`, and the day the new design
 * passes it, it moves to "fixed" (and may then take the flags as fixFlags).
 */
const STEP_B_CASES: readonly ReplayCase[] = [
  {
    id: "nov4-live-ca-t1-step-b",
    title: `CA chat T1 "${CA_CHAIN[0]}" → Create, with Step B ON — the created Observation names "Jane Doe"`,
    report: `${REPORT}: in the sibling app, with Step B on, the create lost the surname; reduceDraftWrite is involved`,
    /*
     * Holds in the pack: with the drafting model's baseline text scripted, Step B's draft write keeps "Jane Doe".
     * A live loss comes from what the drafting model writes; `LIVE_CREATE_REPEAT=1` in
     * evals/live-regressions.eval.ts counts it (5 creates off, 5 on).
     */
    status: "fixed",
    fixFlags: [],
    run: (t) => withStepB(() => caChat(t, 1)),
  },
  {
    id: "nov4-live-ca-t2-step-b-replace",
    title: `CA chat T2 "${CA_CHAIN[1]}" with Step B ON — a patch REPLACING the Observation with "Doe-Smith was late …" must not drop "Jane"`,
    report:
      `${REPORT}: the sibling app's root cause, confirmed by QA — live, the form-patch model sent how:"replace" on the Observation with its own sentence (the new surname, no first name); the reducer checks the evidence, not what the new text removes (form-reducer.ts setOne, a replace on an assistant-owned field). The tester here, flags off, saw the first name kept ("Jane Doe-Smith"); this is the step-B-on variant with a scripted live-shaped patch`,
    // Run 4 Nov 2026: this app has Step B's reducer on main (#494–#496) and it fails here exactly as in the sibling app.
    status: { open: "with Step B on, the replace is accepted on its evidence and the Observation becomes \"Doe-Smith was late to open on 10-20-26.\": \"Jane\" is dropped (and the Expectation with it); nothing checks what a replace removes" },
    fixFlags: [],
    async run(t) {
      await withStepB(async () => {
        t.patchWrites([
          {
            turn: "this_form",
            /*
             * The live shape: a replace with the model's own sentence, in words the manager said. The evidence is
             * her whole turn (a one-word evidence is refused as weak, form-reducer.ts strongEvidence) — still only
             * evidence for the surname, and still nothing checks what the replace removes.
             */
            set: [{ field: "observation", value: "Doe-Smith was late to open on 10-20-26.", how: "replace", evidence: CA_CHAIN[1] }],
            clear: [],
          },
        ]);
        await caChat(t, 2);
      });
    },
  },
  {
    id: "nov4-live-ca-t2-step-b-replace-single-writer",
    title: `CA chat T2 "${CA_CHAIN[1]}" with Step B and FORM_EDIT_SINGLE_WRITER_ENABLED ON — the live replace is refused (drops_words), nothing is written by the patch, and the turn goes on`,
    report: `${REPORT}: the same live patch as nov4-live-ca-t2-step-b-replace, through the one writer (Step 2a, ported from Ask Bubbles 117e33b1)`,
    /*
     * Step 2a: the patch turn hands its ops to writeFormEdits; "Doe-Smith was
     * late …" drops "Jane", which "fix her last name, it is Doe-Smith" does
     * not name — refused, all or nothing, and the turn reaches the old path
     * (the scripted revision), whose Observation keeps "Jane Doe-Smith".
     */
    status: "fixed",
    fixFlags: [],
    async run(t) {
      const before = process.env.FORM_EDIT_SINGLE_WRITER_ENABLED;
      process.env.FORM_EDIT_SINGLE_WRITER_ENABLED = "true";
      try {
        await withStepB(async () => {
          t.patchWrites([
            {
              turn: "this_form",
              set: [{ field: "observation", value: "Doe-Smith was late to open on 10-20-26.", how: "replace", evidence: CA_CHAIN[1] }],
              clear: [],
            },
          ]);
          await caChat(t, 2);
          const observation = t.values(t.forms()[0]!.id as string).observation ?? "";
          expect(observation, "the patch's replace reached the form").not.toMatch(/^Doe-Smith was late/);
        });
      } finally {
        if (before === undefined) delete process.env.FORM_EDIT_SINGLE_WRITER_ENABLED;
        else process.env.FORM_EDIT_SINGLE_WRITER_ENABLED = before;
      }
    },
  },
  {
    id: "nov4-live-ca-t6-step-b-add",
    title: `CA chat T6 "${CA_CHAIN[5]}" with Step B ON — the "add" reaches the Observation (informational: where and in which case it lands)`,
    report: `${REPORT}: in the sibling app, live, the add landed as the last line in lower case ("must practice …")`,
    status: "fixed",
    fixFlags: [],
    async run(t) {
      await withStepB(async () => {
        // T2–T5 have no patch scripted (they fall back to the old path); T6's patch is the live "add".
        t.patchWrites([null, null, null, null, { turn: "this_form", set: [{ field: "observation", value: "she Must Practice the sanitizing checklist every shift.", how: "add", evidence: CA_CHAIN[5] }], clear: [] }]);
        await caChat(t, 6);
        const observation = t.values(t.forms()[0]!.id as string).observation ?? "";
        expect(observation, "the add never reached the Observation").toMatch(/practice the sanitizing checklist every shift\.?$/i);
      });
    },
  },
];

/* ------------------------------------------------- the coaching chat, C1–C3 -- */

async function coachingChat(t: T, upTo: number): Promise<void> {
  t.directory(LIVE_ROSTER);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(COACHING_OPENING);
  expect(thread.proposal, "no coaching card for Dana Lane").toMatchObject({ templateKey: "coaching", employeeName: "Dana Lane" });
  t.draftWrites({ coaching_details: DETAILS_LANE });
  const id = await thread.create();
  for (let turn = 1; turn <= upTo; turn += 1) {
    t.revisionWrites({ coaching_details: DETAILS_AFTER[turn - 1]! });
    const { reply, changed } = await turnOnDraft(t, thread, id, COACHING_CHAIN[turn - 1]!);
    const details = t.values(id).coaching_details ?? "";
    firstNameSurvives(details, "Dana", /\bla(?:i)?ne\b/i, `C${turn}`);
    if (turn !== upTo) continue;
    if (turn === 1) expect(details, "the Details still say Lane").toMatch(/\bDana Laine\b/);
    // The rewording varies from run to run: the Details changed, or the reply honestly says nothing did.
    else if (!changed) expect(claimsFormChange(reply) || !/haven'?t changed|didn'?t change|nothing (?:on the form )?(?:has )?changed/i.test(reply.content), `"${COACHING_CHAIN[turn - 1]}": nothing changed and the reply does not say so`).toBe(false);
  }
}

/** Today's status of each prefix (production flags). */
const COACHING_OPEN: Readonly<Record<number, string>> = {};

const COACHING_CASES: readonly ReplayCase[] = COACHING_CHAIN.map((said, index): ReplayCase => {
  const turn = index + 1;
  const open = COACHING_OPEN[turn];
  return {
    id: `nov4-live-coaching-c${turn}`,
    title: `coaching chat C${turn} "${said}" — the old path`,
    report: `${REPORT} (coaching): C${turn} "${said}"`,
    status: open ? { open } : "fixed",
    fixFlags: [],
    run: (t) => coachingChat(t, turn),
  };
});

/* ---------------------------------------------------------- QA's two more -- */

const QA_EXTRA_CASES: readonly ReplayCase[] = [
  {
    id: "nov4-live-ca-t2-name-line-on-roster",
    title: `CA chat T2 "${CA_CHAIN[1]}" with Jane Doe-Smith on the directory too — the header Name becomes Jane Doe-Smith, or the reply asks to confirm it`,
    report: `${REPORT}: "fix her last name, it is Doe-Smith" leaves the header Employee Name "Jane Doe" (flags off)`,
    /*
     * Run 4 Nov 2026 (production flags, NAME_CORRECTION_WORDS_ENABLED on): the reply is "Updated the Corrective
     * Action Form for Jane Doe: Observation of Offense." — only the Observation changed. The sibling app's
     * diagnosis (the comma in "name, it is" defeats both name readers) is not re-traced here.
     */
    status: { open: "the header Name stays \"Jane Doe\" with Jane Doe-Smith on the directory; the reply updates only the Observation and never asks to confirm the new name; step 5 (names via the tool + roster) is the target" },
    fixFlags: [],
    async run(t) {
      const roster = [...LIVE_ROSTER, at("r1-jane-doe-smith", "Jane", "Doe-Smith")];
      t.directory(roster);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(CA_CHAIN[0]);
      expect(thread.proposal, "T1 made no card for Jane Doe").toMatchObject({ templateKey: "dpoa", employeeName: "Jane Doe" });
      t.draftWrites({ observation: OBSERVATION_AFTER[0]! });
      const id = await thread.create();
      t.revisionWrites({ observation: OBSERVATION_AFTER[1]! });
      const { reply } = await turnOnDraft(t, thread, id, CA_CHAIN[1]);
      const renamed = t.values(id).employee_name === "Jane Doe-Smith";
      const asksToConfirm = /Jane Doe-Smith/.test(reply.content) && /\?/.test(reply.content);
      expect(renamed || asksToConfirm, `the header Name stays "${t.values(id).employee_name}" and the reply does not ask to confirm:\n${reply.content}`).toBe(true);
    },
  },
  {
    id: "nov4-live-street-address-not-a-person",
    title: "\"Corrective action for 123 Main Street\" — no card for an address, and the reply asks who it is for instead of looking an address up as a person",
    report: 'QA, 4 Nov 2026: "Corrective action for 123 Main Street"',
    /*
     * Run 4 Nov 2026: STREET_ADDRESS_NOT_A_NAME_ENABLED and ADDRESS_NOT_PERSON_ENABLED (both on) keep the address
     * off the card and out of the roster lookup — those two checks hold — but the turn is answered as a policy
     * question (the pack's stand-in answer) instead of asking who the form is for.
     */
    status: { open: "no card and no roster lookup of the address (the street-address guard holds), but no question either: it is answered as a policy question and never asks who the form is for" },
    fixFlags: [],
    async run(t) {
      t.directory(LIVE_ROSTER);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("Corrective action for 123 Main Street");
      expect(thread.proposal?.employeeName ?? "", "a card names the address").not.toMatch(/main street|123/i);
      expect(reply.content, "the address was looked up as a person").not.toMatch(/(?:couldn'?t|could not|didn'?t|did not) find[^.\n]*123 Main Street/i);
      expect(reply.content, "the reply does not ask who it is for").toMatch(/who is this|which employee|who(?:'s| is) it for/i);
    },
  },
  {
    id: "nov4-live-coaching-then-jane-doe",
    title: "\"I need a coaching form\" then \"On 10-20-26 Jane Doe was late\" — the card is for Jane Doe (on the roster)",
    report: 'QA, 4 Nov 2026: "I need a coaching form" → "On 10-20-26 Jane Doe was late"',
    status: "fixed",
    fixFlags: [],
    async run(t) {
      t.directory(LIVE_ROSTER);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("I need a coaching form");
      await thread.say("On 10-20-26 Jane Doe was late");
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", employeeName: "Jane Doe" });
    },
  },
];

export const NOV4_LIVE_REGRESSION_CASES: readonly ReplayCase[] = [...CA_CASES, ...STEP_B_CASES, ...COACHING_CASES, ...QA_EXTRA_CASES];

/* ------------------------------------------------- QA's 20 name wordings -- */

/*
 * Each wording × ON roster (Corin Bellweather on the directory) / OFF roster
 * (not on it) × two modes:
 *   code-only   the stand-in reading models read nothing;
 *   models      the slot model and the AI reader quote the name as typed
 *               (`t.slotsRead({ employee: typed, formTurn: true, formType: "Corrective Action Form" }, typed)`
 *               before the turn: this harness's reading models).
 *
 * ON: the card is for exactly "Corin Bellweather". OFF: a card for the name
 * as typed, or the reply asks who it is for or says the name is not on the
 * team — once — and never invents a person or keeps a non-person ("BY …").
 *
 * Step 5's pass criterion: all 20 make a card for Corin Bellweather ON
 * roster; OFF roster never invents. Today's misses are `open` below, keyed
 * `<wording>-<on|off>-<mode>`.
 */
type Mode = "code" | "models";

/*
 * THIS APP'S OFF-ROSTER RULE differs from the sibling's on purpose: a typed name
 * not on the directory proceeds as typed (TYPED_NAME_PROCEEDS_ENABLED; the
 * manager's own spelling is kept, 22 Oct 2026). So OFF roster a card for the
 * name as typed is allowed, as is asking who once; never a non-person
 * ("BY …"), never someone else.
 *
 * Today's results (production flags), from running the pack on 4 Nov 2026,
 * matching QA's counts:
 *   ON roster, code only       19/20 cards for Corin Bellweather
 *   ON roster, models read     19/20
 *   OFF roster, code only       6/20 cards for the typed name (Sentence case only); lower, CAPS and both of
 *                               Pau's sentences ask "Who is this Corrective Action Form for?"
 *   OFF roster, models read    19/20 cards for the name as typed ("corin bellweather", "CORIN BELLWEATHER")
 * The one miss in every column: last-date-caps ("… ON MONDAY 10/05/2026 BY CORIN BELLWEATHER") replies
 * "I'll draft a Corrective Action Form for **BY CORIN BELLWEATHER**", and the card carries no employee.
 *
 * TODO(QA): when QA sends a further exact matrix, add its wordings in
 * `nov4-live-regressions-scenarios.ts` and their misses here.
 */
const BY_MISS = "the non-person \"BY CORIN BELLWEATHER\" is taken as the name (\"I'll draft a Corrective Action Form for **BY CORIN BELLWEATHER**\"), and the card has no employee";
const NAME_OPEN: Readonly<Record<string, string>> = Object.fromEntries(
  /*
   * OFF roster: before FORM_NAME_FROM_ROSTER_ENABLED and CA_SALES_POLICY_ENABLED
   * were on together in production (5 Nov 2026) these were OPEN too, for the
   * same miss; with them the request slot leaves "BY CORIN BELLWEATHER" out and
   * the off-roster cases hold. The on-roster ones still miss.
   */
  (["on"] as const).flatMap((roster) => (["code", "models"] as const).map((mode) => [`last-date-caps-${roster}-${mode}`, BY_MISS])),
);

const ASKED_WHO = /who is this\b[^?\n]*\bfor\?/i;
const NOT_ON_TEAM = /(?:couldn'?t|could not|didn'?t|did not) find[^.\n]*(?:roster|team|directory)|not (?:on|in) (?:the|your) (?:woven )?(?:roster|team|directory)/i;

function nameCase(wording: NameWording, onRoster: boolean, mode: Mode): ReplayCase {
  const key = `${wording.id}-${onRoster ? "on" : "off"}-${mode}`;
  const open = NAME_OPEN[key];
  return {
    id: `nov4-name-${key}`,
    title: `"${wording.text}" — ${onRoster ? "on roster: the card is for Corin Bellweather" : "off roster: asks who, invents no one"} (${mode === "code" ? "code only" : "models read the name"})`,
    report: `QA's exact name matrix, 4 Nov 2026: "${wording.text}"`,
    status: open ? { open } : "fixed",
    fixFlags: [],
    async run(t) {
      t.directory(nameRoster(onRoster));
      t.as("salon_director", KEARNEY);
      if (mode === "models") t.slotsRead({ employee: wording.typed, formTurn: true, formType: "Corrective Action Form" }, wording.typed);
      const thread = t.thread();
      const reply = await thread.say(wording.text);
      const employee = thread.proposal?.employeeName ?? null;
      if (onRoster) {
        expect(employee, `no card for ${NAME}:\n${reply.content}`).toBe(NAME);
        return;
      }
      expect(reply.content, "a non-person kept as the name").not.toMatch(/\bBY\s+CORIN\b|\bby corin\b/);
      // The name as typed proceeds (this app's rule, see above): a card for exactly that name, never someone else.
      if (employee) {
        expect(employee.toLowerCase(), "a card names someone other than the name typed").toBe(NAME.toLowerCase());
        return;
      }
      expect(ASKED_WHO.test(reply.content) || NOT_ON_TEAM.test(reply.content), `no card, and neither asks who nor says the name is not on the team:\n${reply.content}`).toBe(true);
      expect(reply.content.match(/who is this/gi)?.length ?? 0, "asked more than once").toBeLessThanOrEqual(1);
    },
  };
}

export const NOV4_NAME_WORDING_CASES: readonly ReplayCase[] = NAME_WORDINGS.flatMap((wording) =>
  [true, false].flatMap((onRoster) => (["code", "models"] as const).map((mode) => nameCase(wording, onRoster, mode))),
);
