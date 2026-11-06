import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "BRING UP <NAME>'S CORRECTIVE ACTION" — A FORM ON FILE, ASKED FOR WITH ANY
 * VERB THAT OPENS IT (QA's history review of a location manager's chats,
 * 5 Nov 2026)
 * ============================================================================
 *
 * Four 1-star ratings: only "edit" reopened a form already on file. The
 * manager's turns are verbatim but for the names, which are invented
 * (Odalys Fairbank; first name only: Marisol, of Marisol Quintero). The
 * manager is the actor.
 *
 *   "bring up <A>'s corrective action"                       → "Who is this form for?"
 *   "bring up an old coaching form for <first name>"         → "Is this for <A>?" → "yes" → a NEW Coaching proposal
 *   "bring up a previously edited corrective action for <A>" → a NEW Corrective Action
 *   "bring up a previous corrective action form that i made
 *    for <A> earlier today"                                  → starts over
 *
 * Expected: the form on file for that person opens (a finalized one as a new
 * draft of it, as "edit" does); no new proposal; never "Who is this form
 * for?". Fixed behind REOPEN_BY_ANY_OPEN_VERB_ENABLED (default off).
 *
 * Negatives, which hold today and with the flag: "write up <A> for …" still
 * proposes a new form; "bring up the coaching form" with nobody named opens
 * nothing. And "bring up <A>'s CA" when she has none says it could not find
 * one, never a new card (OPEN today: it starts a new form).
 *
 * QA/Pau's scope, 6 Nov 2026 ("managers asking for previous forms", Coaching
 * and Corrective Action alike): (A) any open verb with previous / old / last
 * / earlier, "… I made earlier today", a possessive first name that is one
 * roster person — opens; (B) "are there any coaching and CA's for <name>",
 * "what forms does <name> have", "show me <name>'s past write-ups" — answered
 * from the forms on file (PAST_FORMS_BEFORE_LIBRARY_ENABLED), never the
 * catalogue or a new card. Several on file: listed (type, date, status), and
 * the manager asked which. None: said so.
 */

type T = ReplayContext;

const REPORT = "QA's history review of a location manager's chats, 5 Nov 2026";
const FLAG = ["REOPEN_BY_ANY_OPEN_VERB_ENABLED"];

const ODALYS: DirectoryRow = {
  id: "e-odalys-fairbank",
  firstName: "Odalys",
  lastName: "Fairbank",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const MARISOL: DirectoryRow = {
  id: "e-marisol-quintero",
  firstName: "Marisol",
  lastName: "Quintero",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function reopenByOpenVerbPeople(): readonly DirectoryRow[] {
  return [ODALYS, MARISOL];
}

const ASKS_WHO = /Who is this (?:\*\*[^*]+\*\* |form )?for\?|Is this for \*{0,2}[A-Z]/i;
const NOT_FOUND = /I couldn't find/i;

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  t.directory([...STAFF, ODALYS, MARISOL]);
  t.as("salon_director", KEARNEY);
}

/** A Corrective Action for Odalys Fairbank, made in an earlier chat (a draft). */
async function caOnFile(t: T): Promise<string> {
  const earlier = t.thread();
  await earlier.say("I need a corrective action for Odalys Fairbank, she was late opening the salon on Monday");
  t.draftWrites({ observation: "Observed:\nOdalys Fairbank opened the salon late on Monday." });
  return earlier.create();
}

/** A Coaching Form for Marisol Quintero, made in an earlier chat. */
async function coachingOnFile(t: T): Promise<string> {
  const earlier = t.thread();
  await earlier.say("I need a coaching form for Marisol Quintero, she left two tanning beds uncleaned on Sunday");
  t.draftWrites({ coaching_details: "Marisol Quintero left two tanning beds uncleaned on Sunday." });
  return earlier.create();
}

/** A form of either family for either person, made in an earlier chat; finalized when asked. */
async function onFile(t: T, family: "ca" | "coaching", person: DirectoryRow, finalized = false): Promise<string> {
  const name = `${person.firstName} ${person.lastName}`;
  const earlier = t.thread();
  if (family === "ca") {
    await earlier.say(`I need a corrective action for ${name}, she was late opening the salon on Monday`);
    t.draftWrites({ observation: `Observed:\n${name} opened the salon late on Monday.` });
  } else {
    await earlier.say(`I need a coaching form for ${name}, she left two tanning beds uncleaned on Sunday`);
    t.draftWrites({ coaching_details: `${name} left two tanning beds uncleaned on Sunday.` });
  }
  const id = await earlier.create();
  if (finalized) finalize(t, id);
  return id;
}

/** The manager finalized it. */
function finalize(t: T, id: string) {
  const row = t.forms().find((form) => form.id === id);
  if (!row) throw new Error(`no form ${id} on file`);
  row.status = "finalized";
}

/** The form on file opened: the form itself, or (finalized) a new draft of it. */
function opens(reply: ReplayAnswer, id: string, said: string) {
  expect(reply.content, `"${said}" asks who the form is for:\n${reply.content}`).not.toMatch(ASKS_WHO);
  const opened = reply.formOpened as { instanceId: string; revisesInstanceId?: string | null } | undefined;
  expect(opened, `"${said}" opens no form on file:\n${reply.content}`).toBeDefined();
  expect([opened!.instanceId, opened!.revisesInstanceId], `"${said}" opens another form:\n${reply.content}`).toContain(id);
  expect(reply.formProposal, `"${said}" proposes a new form:\n${reply.content}`).toBeUndefined();
}

const BOTH = ["PAST_FORMS_BEFORE_LIBRARY_ENABLED", "REOPEN_BY_ANY_OPEN_VERB_ENABLED"];
const LIBRARY_ANSWER = /I can create it here|is filed under|^Yes\. \*\*/;

/*
 * (A) OPEN, both families (QA/Pau, 6 Nov 2026: "managers asking for previous
 * forms"): any open verb, a previous/old/last/earlier modifier, a form made
 * "earlier today", a possessive first name. One form on file: it opens.
 */
const OPEN_WORDINGS: readonly (readonly [string, "ca" | "coaching", DirectoryRow, boolean, string])[] = [
  ["bring-up-my-previous-ca", "ca", ODALYS, false, "bring up my previous CA for Odalys Fairbank"],
  ["open-my-last-ca-finalized", "ca", ODALYS, true, "open my last corrective action for Odalys Fairbank"],
  ["find-my-earlier-ca", "ca", ODALYS, false, "find my earlier CA for Odalys Fairbank"],
  ["show-my-previous-ca-finalized", "ca", ODALYS, true, "show my previous corrective action for Odalys Fairbank"],
  ["ca-made-earlier-today", "ca", ODALYS, false, "bring up the CA I made earlier today for Odalys Fairbank"],
  ["pull-up-my-old-coaching-finalized", "coaching", MARISOL, true, "pull up my old coaching form for Marisol Quintero"],
  ["show-my-previous-coaching", "coaching", MARISOL, false, "show my previous coaching form for Marisol Quintero"],
  ["open-my-last-coaching-first-name", "coaching", MARISOL, false, "open my last coaching form for Marisol"],
  ["find-my-earlier-coaching", "coaching", MARISOL, false, "find my earlier coaching form for Marisol Quintero"],
  ["coaching-first-name-possessive", "coaching", MARISOL, false, "bring up Marisol's coaching form"],
  ["coaching-made-earlier-today-finalized", "coaching", MARISOL, true, "pull up the coaching form I made earlier today for Marisol Quintero"],
];

/*
 * (B) LIST / QUESTION, both families: answered from the forms on file
 * (PAST_FORMS_BEFORE_LIBRARY_ENABLED's ordering), never the form catalogue,
 * never a new card. "are there any coaching and CA's for <name>" got the
 * catalogue in a chat of the sibling app on 4 Nov.
 */
const LIST_WORDINGS: readonly (readonly [string, string])[] = [
  ["any-coaching-and-cas", "are there any coaching and CA's for Odalys Fairbank"],
  ["what-forms-does-she-have", "what forms does Odalys Fairbank have"],
  ["past-write-ups", "show me Odalys Fairbank's past write-ups"],
  ["any-coachings", "are there any coachings for Odalys Fairbank"],
  ["what-coaching-forms", "what coaching forms does Odalys Fairbank have"],
  ["past-coachings", "show me Odalys Fairbank's past coachings"],
];

/*
 * Wordings that already hold with production's flags (checked 6 Nov 2026):
 * "show" opened a draft before the flag, and the questions below are already
 * answered without the catalogue or a card. Kept as guards ("fixed").
 */
const HOLDS_TODAY = new Set(["show-my-previous-coaching", "what-forms-does-she-have", "past-write-ups", "any-coachings", "what-coaching-forms", "past-coachings"]);

export const NOV6_CODING3_REOPEN_PREVIOUS_FORMS_CASES: ReplayCase[] = [
  ...OPEN_WORDINGS.map(
    ([key, family, person, finalized, said]): ReplayCase => ({
      id: `nov6-reopen-a-${key}`,
      title: `(A) "${said}" (${finalized ? "finalized" : "a draft"}, another chat) opens it; never a new form`,
      report: `${REPORT}: QA/Pau, 6 Nov 2026 — managers asking for previous forms, (A) open`,
      status: HOLDS_TODAY.has(key) ? "fixed" : { open: "does not open the form on file" },
      fixFlags: FLAG,
      async run(t: T) {
        start(t);
        const id = await onFile(t, family, person, finalized);
        const thread = t.thread();
        opens(await thread.say(said), id, said);
        expect(thread.proposal, `"${said}" proposes a new form`).toBeNull();
      },
    }),
  ),
  ...LIST_WORDINGS.map(
    ([key, said]): ReplayCase => ({
      id: `nov6-reopen-b-${key}`,
      title: `(B) "${said}": answered from her forms on file; never the form catalogue, never a new card`,
      report: `${REPORT}: QA/Pau, 6 Nov 2026 — managers asking for previous forms, (B) list / question`,
      status: HOLDS_TODAY.has(key) ? "fixed" : { open: "answered from the form catalogue, or a new card" },
      fixFlags: BOTH,
      async run(t: T) {
        start(t);
        await onFile(t, "ca", ODALYS);
        await onFile(t, "coaching", ODALYS, true);
        const before = t.forms().length;
        const thread = t.thread();
        const reply = await thread.say(said);
        expect(reply.content, `the form catalogue:\n${reply.content}`).not.toMatch(LIBRARY_ANSWER);
        expect(reply.content, `asks who:\n${reply.content}`).not.toMatch(ASKS_WHO);
        expect(thread.proposal, `a new card:\n${reply.content}`).toBeNull();
        expect(t.forms().length, `a new form:\n${reply.content}`).toBe(before);
      },
    }),
  ),
  {
    id: "nov6-reopen-coaching-none-on-file",
    title: "\"pull up my old coaching form for Odalys Fairbank\" with none on file says so; no new card",
    report: `${REPORT}: QA/Pau, 6 Nov 2026 — none on file: say so plainly, never a new blank form`,
    status: { open: "starts a new Coaching Form" },
    fixFlags: FLAG,
    async run(t: T) {
      start(t);
      await onFile(t, "ca", ODALYS);
      const thread = t.thread();
      const reply = await thread.say("pull up my old coaching form for Odalys Fairbank");
      expect(reply.content, `does not say none is on file:\n${reply.content}`).toMatch(NOT_FOUND);
      expect(thread.proposal, `a new card:\n${reply.content}`).toBeNull();
      expect(reply.formOpened, `opens a form:\n${reply.content}`).toBeUndefined();
    },
  },
  {
    id: "nov6-reopen-several-coachings-asks-which",
    title: "two Coaching Forms on file for Marisol Quintero: lists both (type, date, status) and asks which; \"the finalized one\" opens it as a new draft",
    report: `${REPORT}: QA/Pau, 6 Nov 2026 — several forms on file: list them and ask which`,
    status: { open: "starts a new Coaching Form instead of listing the ones on file" },
    fixFlags: FLAG,
    async run(t: T) {
      start(t);
      vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
      const older = await onFile(t, "coaching", MARISOL, true);
      vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
      await onFile(t, "coaching", MARISOL);
      const thread = t.thread();
      const asked = await thread.say("bring up Marisol Quintero's coaching form");
      expect(asked.content, `does not ask which:\n${asked.content}`).toMatch(/Which one should I open\?/);
      expect(asked.content, `does not list type, status and date:\n${asked.content}`).toMatch(/Coaching Form\*\* for \*\*Marisol Quintero\*\* — finalized, created Nov 3, 2026/);
      expect(asked.formOpened, `opens one without asking:\n${asked.content}`).toBeUndefined();
      expect(thread.proposal, `a new card:\n${asked.content}`).toBeNull();
      opens(await thread.say("the finalized one"), older, "the finalized one");
    },
  },
];

/*
 * QA's decisions, 6 Nov 2026. (b) "show" and "find" DISPLAY a finalized form
 * (with the "Edit as new draft" offer); "bring up", "pull up", "open" and
 * "edit" OPEN it as a new draft. (c) "open a CA for <name>" starts a new one;
 * "open the CA for <name>", "open her CA" reopen. (d) several on file → asked
 * which, for every verb, "edit" included.
 */
function opened(reply: ReplayAnswer) {
  return reply.formOpened as { instanceId: string; revisesInstanceId?: string | null } | undefined;
}

export const NOV6_CODING3_REOPEN_QA_DECISION_CASES: ReplayCase[] = [
  ...(
    [
      ["find", "find my earlier CA for Odalys Fairbank"],
      ["show", "show my previous corrective action for Odalys Fairbank"],
    ] as const
  ).map(
    ([verb, said]): ReplayCase => ({
      id: `nov6-reopen-qa-b-${verb}-displays-finalized`,
      title: `QA (b): "${said}" with it finalized DISPLAYS it (Edit as new draft offered); no new draft`,
      report: `${REPORT}: QA decision (b), 6 Nov 2026 — "show" and "find" display a finalized form`,
      status: { open: "the form on file is not displayed (\"find\" is no reopen verb; \"corrective action\" names no form)" },
      fixFlags: FLAG,
      async run(t: T) {
        start(t);
        const id = await onFile(t, "ca", ODALYS, true);
        const reply = await t.thread().say(said);
        opens(reply, id, said);
        expect(opened(reply)!.instanceId, `"${said}" opens a new draft instead of displaying:\n${reply.content}`).toBe(id);
        expect(reply.content, `no "Edit as new draft" offer:\n${reply.content}`).toMatch(/Edit as new draft/);
      },
    }),
  ),
  ...(
    [
      ["bring-up", "bring up the CA for Odalys Fairbank"],
      ["pull-up", "pull up Odalys Fairbank's CA"],
      ["open", "open the CA for Odalys Fairbank"],
    ] as const
  ).map(
    ([verb, said]): ReplayCase => ({
      id: `nov6-reopen-qa-b-${verb}-opens-finalized-as-draft`,
      title: `QA (b)/(c): "${said}" with it finalized OPENS it as a new draft of it`,
      report: `${REPORT}: QA decision (b), 6 Nov 2026 — "bring up", "pull up", "open" open a finalized form as a revision draft`,
      status: { open: "starts a new Corrective Action instead of opening the one on file" },
      fixFlags: FLAG,
      async run(t: T) {
        start(t);
        const id = await onFile(t, "ca", ODALYS, true);
        const reply = await t.thread().say(said);
        opens(reply, id, said);
        expect(opened(reply)!.revisesInstanceId, `"${said}" does not open a new draft of the finalized form:\n${reply.content}`).toBe(id);
      },
    }),
  ),
  {
    id: "nov6-reopen-qa-c-open-a-ca-is-new",
    title: "QA (c): \"open a CA for Odalys Fairbank\" with one on file starts a NEW Corrective Action card",
    report: `${REPORT}: QA decision (c), 6 Nov 2026 — managers say "open a CA for <name>" to start a new one`,
    status: "fixed",
    fixFlags: FLAG,
    async run(t: T) {
      start(t);
      await onFile(t, "ca", ODALYS);
      const thread = t.thread();
      const reply = await thread.say("open a CA for Odalys Fairbank for being late opening the salon on Tuesday");
      expect(reply.formOpened, `opens the one on file:\n${reply.content}`).toBeUndefined();
      expect(thread.proposal, `no new Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Odalys Fairbank" });
    },
  },
  {
    id: "nov6-reopen-qa-c-open-her-ca",
    title: "QA (c): in the chat it was made in, \"open her CA\" opens it",
    report: `${REPORT}: QA decision (c), 6 Nov 2026 — a possessive determiner means the form on file`,
    status: { open: "\"open her CA\" does not open the form" },
    fixFlags: FLAG,
    async run(t: T) {
      start(t);
      const thread = t.thread();
      await thread.say("I need a corrective action for Odalys Fairbank, she was late opening the salon on Monday");
      t.draftWrites({ observation: "Observed:\nOdalys Fairbank opened the salon late on Monday." });
      const id = await thread.create();
      const reply = await thread.say("open her CA");
      opens(reply, id, "open her CA");
    },
  },
  {
    id: "nov6-reopen-qa-d-edit-several-asks-which",
    title: "QA (d): two Corrective Actions on file, \"edit Odalys Fairbank's CA\" lists both and asks which; \"1\" opens the newer",
    report: `${REPORT}: QA decision (d), 6 Nov 2026 — several on file: ask which, for every verb including "edit"`,
    status: { open: "\"edit\" opens the newest without asking" },
    fixFlags: FLAG,
    async run(t: T) {
      start(t);
      vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
      await onFile(t, "ca", ODALYS, true);
      vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
      const newer = await onFile(t, "ca", ODALYS);
      const thread = t.thread();
      const asked = await thread.say("edit Odalys Fairbank's CA");
      expect(asked.content, `does not ask which:\n${asked.content}`).toMatch(/Which one should I open\?/);
      expect(asked.formOpened, `opens one without asking:\n${asked.content}`).toBeUndefined();
      opens(await thread.say("1"), newer, "1");
    },
  },
];

export const NOV6_CODING3_REOPEN_BY_OPEN_VERB_CASES: ReplayCase[] = [
  {
    id: "nov6-reopen-bring-up-possessive-ca",
    title: "\"bring up Odalys Fairbank's corrective action\" (made in another chat) opens it; never \"Who is this form for?\"",
    report: `${REPORT}: "bring up <name>'s corrective action" → "Who is this form for?"`,
    status: { open: "asks who the form is for instead of opening the Corrective Action on file" },
    fixFlags: FLAG,
    async run(t: T) {
      start(t);
      const id = await caOnFile(t);
      const said = "bring up Odalys Fairbank's corrective action";
      opens(await t.thread().say(said), id, said);
    },
  },
  {
    id: "nov6-reopen-bring-up-old-coaching-first-name",
    title: "\"bring up an old coaching form for Marisol\" (finalized, another chat) opens a new draft of it; never \"Is this for …?\" then a new Coaching proposal",
    report: `${REPORT}: "bring up an old coaching form for <first name>" → "Is this for <name>?" → "yes" → a new Coaching proposal`,
    status: { open: "asks \"Is this for …?\" and, on \"yes\", proposes a new Coaching Form" },
    fixFlags: FLAG,
    async run(t: T) {
      start(t);
      const id = await coachingOnFile(t);
      finalize(t, id);
      const thread = t.thread();
      const said = "bring up an old coaching form for Marisol";
      const reply = await thread.say(said);
      opens(reply, id, said);
      expect(thread.proposal, `a new Coaching proposal:\n${reply.content}`).toBeNull();
    },
  },
  {
    id: "nov6-reopen-bring-up-previously-edited-ca",
    title: "\"bring up a previously edited corrective action for Odalys Fairbank\" (finalized) opens a new draft of it; never a new Corrective Action",
    report: `${REPORT}: "bring up a previously edited corrective action for <name>" → a new Corrective Action`,
    status: { open: "proposes a new Corrective Action instead of opening the one on file" },
    fixFlags: FLAG,
    async run(t: T) {
      start(t);
      const id = await caOnFile(t);
      finalize(t, id);
      const said = "bring up a previously edited corrective action for Odalys Fairbank";
      opens(await t.thread().say(said), id, said);
    },
  },
  {
    id: "nov6-reopen-bring-up-made-earlier-today",
    title: "\"bring up a previous corrective action form that i made for Odalys Fairbank earlier today\" opens it; never starts over",
    report: `${REPORT}: "bring up a previous corrective action form that i made for <name> earlier today" → starts over`,
    status: { open: "starts a new Corrective Action instead of opening the one made earlier" },
    fixFlags: FLAG,
    async run(t: T) {
      start(t);
      const id = await caOnFile(t);
      const said = "bring up a previous corrective action form that i made for Odalys Fairbank earlier today";
      opens(await t.thread().say(said), id, said);
    },
  },
  {
    id: "nov6-reopen-bring-up-first-name-possessive",
    title: "\"bring up Odalys's corrective action\" (first name, one person on the roster) opens her Corrective Action on file",
    report: `${REPORT}: "bring up <first name>'s corrective action" (QA/Pau, 6 Nov 2026: the first name matches exactly one roster person)`,
    status: { open: "asks who the form is for instead of opening the Corrective Action on file" },
    fixFlags: FLAG,
    async run(t: T) {
      start(t);
      const id = await caOnFile(t);
      const said = "bring up Odalys's corrective action";
      opens(await t.thread().say(said), id, said);
    },
  },
  {
    id: "nov6-reopen-several-on-file-asks-which",
    title: "two Corrective Actions on file for Odalys Fairbank: \"bring up Odalys Fairbank's corrective action\" lists both and asks which; \"2\" opens the older (finalized) one as a new draft",
    report: `${REPORT}: QA/Pau, 6 Nov 2026 — several forms on file for that person: list them and ask which`,
    status: { open: "starts a new Corrective Action instead of listing the ones on file" },
    fixFlags: FLAG,
    async run(t: T) {
      start(t);
      const older = await caOnFile(t);
      finalize(t, older);
      vi.setSystemTime(new Date("2026-11-05T17:00:00Z"));
      const newer = await caOnFile(t);
      expect(newer, "the second Corrective Action is a separate form").not.toBe(older);
      const thread = t.thread();
      const asked = await thread.say("bring up Odalys Fairbank's corrective action");
      expect(asked.content, `does not ask which:\n${asked.content}`).toMatch(/Which one should I open\?/);
      expect(asked.formOpened, `opens one without asking:\n${asked.content}`).toBeUndefined();
      expect(thread.proposal, `a new card:\n${asked.content}`).toBeNull();
      opens(await thread.say("2"), older, "2");
    },
  },
  {
    id: "nov6-reopen-bring-up-ca-none-on-file",
    title: "\"bring up Odalys Fairbank's CA\" with none on file says it couldn't find one; no new card",
    report: `${REPORT}: negative — a form asked for that is not on file is said to be missing, never started over`,
    status: { open: "starts a new Corrective Action" },
    fixFlags: FLAG,
    async run(t: T) {
      start(t);
      const thread = t.thread();
      const reply = await thread.say("bring up Odalys Fairbank's CA");
      expect(reply.content, `does not say none is on file:\n${reply.content}`).toMatch(NOT_FOUND);
      expect(thread.proposal, `a new card:\n${reply.content}`).toBeNull();
      expect(reply.formOpened, `opens a form:\n${reply.content}`).toBeUndefined();
    },
  },
  {
    id: "nov6-reopen-write-up-still-creates",
    title: "\"write up Odalys Fairbank for …\" with a Corrective Action on file still proposes a new one",
    report: `${REPORT}: negative — asking to write someone up is a new form, whatever is on file`,
    status: "fixed",
    fixFlags: FLAG,
    async run(t: T) {
      start(t);
      await caOnFile(t);
      const thread = t.thread();
      const reply = await thread.say("write up Odalys Fairbank for not opening the salon on time on Tuesday");
      expect(reply.formOpened, `opens the form on file:\n${reply.content}`).toBeUndefined();
      expect(thread.proposal, `no new Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Odalys Fairbank" });
    },
  },
  {
    id: "nov6-reopen-bring-up-coaching-nobody-named",
    title: "\"bring up the coaching form\" with nobody named opens no form on file",
    report: `${REPORT}: negative — with no person named there is nobody's form to look up`,
    status: "fixed",
    fixFlags: FLAG,
    async run(t: T) {
      start(t);
      await coachingOnFile(t);
      const reply = await t.thread().say("bring up the coaching form");
      expect(reply.formOpened, `opens somebody's form on file:\n${reply.content}`).toBeUndefined();
    },
  },
];
