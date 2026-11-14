import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * AGENT LOOP, PART 2 — FIVE CHATS THAT MUST COME OUT THE SAME WITH THE LOOP ON (QA via Pau, 14 Nov 2026;
 * AGENT_LOOP_ENABLED)
 * ============================================================================
 *
 * Gate-Sunny's set for Coding-7's Part 2. Each chat runs as production does, flags off and with AGENT_LOOP_ENABLED;
 * the expectations are what production's flags give today (main 8c61eed7): the card (template, person, title), the
 * policy, the salon, and that a FINALIZED form already on file is never touched (not re-saved, not revised, not
 * reopened). Every person is invented.
 *
 *  1. Pau's dress-code chat (morning scan, 13 Nov 2026): a written CA for being out of dress code → Dress Code, never
 *     Late Opening from the finalized Late Opening CA on file.
 *  2. "create a coaching form for <name>" asks what happened, and the card offers no Create until the account arrives.
 *  3. sf-s29: "are there any coaching and ca's for <name>" is answered from the forms on file — no card, no library.
 *  4. Two roster people with one name: asked which; the number picks that person and their title.
 *  5. A salon answered to the off-roster offer ("KS Manhattan") is the salon, never a person.
 *
 * QA's two bars for the loop ON (14 Nov 2026), checked where the loop really answers (`t.loopActive`): in 4, no Create
 * before the person is chosen; in 5, no Create with no employee. These chats set no stand-in model, so in this file
 * both rows run today's path (an empty AGENT_LOOP_USERS is nobody); the loop's own runs of the same bars are in
 * `nov14-agent-loop-cases.ts`.
 */
const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA via Pau (14 Nov 2026): agent-loop Part 2 set; invented people";
type T = ReplayContext;

const policyLine = (content: string) => content.split("\n").find((line) => line.startsWith("**Policy:**")) ?? "";
const titleLine = (content: string) => /\*\*Job title:\*\*\s*([^\n]*)/.exec(content)?.[1]?.trim() ?? "";
const card = (proposal: unknown) =>
  (proposal ?? null) as { templateKey?: string; employeeName?: string | null; employeeRole?: string | null; locationId?: string | null; supportsInlineDraft?: boolean } | null;

/** A finalized verbal CA already on file for `name`, made through the chat as production makes one. */
async function finalizedOnFile(t: T, name: string, request: string, observation: string): Promise<string> {
  const thread = t.thread();
  await thread.say(request);
  t.draftWrites({ observation }, { warning_type: ["verbal"] });
  const id = await thread.create();
  Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: "2026-10-26" });
  return id;
}

/** Every finalized form, as it is now: re-read at the end, it must be the same. */
function finalizedForms(t: T) {
  return JSON.stringify(t.forms().filter((row) => row.status === "finalized").map((row) => ({ ...row })));
}
function untouched(t: T, before: string, calls: { revision: number; patch: number }) {
  expect(finalizedForms(t), "a finalized form was changed").toBe(before);
  expect(t.calls().revision, "a revision ran against a form on file").toBe(calls.revision);
}

/* 1 ------------------------------------------------------------------------------------------- dress-code chat --- */
const BRIONY: DirectoryRow = { id: "e-briony-calloway", firstName: "Briony", lastName: "Calloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const DRESS_T1 = "Please create a CA written warning for Briony Calloway for being out of dresscode on 11/13. Briony Calloway wore her coat during Briony Calloways shift after previosly being asked to take it off multiple times.";
/** The manual's Dress Code section, as the production manual rows hold it (as nov10-not-following-dress-code-cases.ts pins it). */
const DRESS_CODE_CHUNK = {
  chunkIndex: 44,
  chunkId: "jba-44",
  locator: "Page 15 — Dress Code for The Company",
  page: 16,
  content:
    "Dress Code for The Company\nThe Company Employees are to keep a neat, clean, professional appearance at all times. Anyone\nviolating their Brand’s Dress code policy will be sent home to change into proper work attire.",
  section: "Dress Code for The Company",
  printedPage: 15,
  sections: [
    { heading: "Dress Code for The Company", page: 15 },
    { heading: "All Locations Dress Code", page: 15 },
  ],
};
const DRESS_T2 = "Write me a CA form for Briony Calloway having a black crewneck on during her shift, not a zip up jacket on 11/13 and 11/6";

/* 4 ------------------------------------------------------------------------------------------- same-name staff --- */
const SECOND_MARNIE: DirectoryRow = { id: "e-90", firstName: "Marnie", lastName: "Holloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Assistant Salon Director" };

/* 3 ---------------------------------------------------------------------------------------------------- sf-s29 --- */
const JOVELLE: DirectoryRow = { id: "e-jovelle-kerrigan", firstName: "Jovelle", lastName: "Kerrigan", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

export const NOV14_AGENT_LOOP_PART2_CASES: ReplayCase[] = [
  {
    id: "nov14-agent-loop-dress-code-chat",
    title: `Pau's dress-code chat, a finalized Late Opening CA on file: a Dress Code CA for Briony Calloway at NE Kearney; the finalized CA untouched`,
    report: `${REPORT}; Pau's morning scan, 13 Nov 2026 (dress-code chat)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, BRIONY]);
      t.as("salon_director", KEARNEY);
      t.manualAlsoHas?.([DRESS_CODE_CHUNK]);
      await finalizedOnFile(t, "Briony Calloway", "create a verbal ca for Briony Calloway for late opening on 10/26/26, she opened the salon 20 minutes late", "Observed:\nBriony Calloway opened the salon 20 minutes late on 10/26/26.");
      const before = finalizedForms(t);
      const calls = t.calls();
      const thread = t.thread();
      for (const [i, turn] of [DRESS_T1, DRESS_T2, DRESS_T2].entries()) {
        t.slotsRead({ employee: "Briony Calloway", formType: "Corrective Action Form", formTurn: true, policyHeading: "Dress Code for The Company" });
        const reply = await thread.say(turn);
        expect(card(thread.proposal), `t${i + 1}: no CA card for Briony Calloway:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Briony Calloway" });
        expect(card(thread.proposal)?.locationId ?? null, `t${i + 1}: not filed at NE Kearney:\n${reply.content}`).toBe("loc-0309");
        expect(policyLine(reply.content), `t${i + 1}: not the Dress Code policy:\n${reply.content}`).toMatch(/dress code/i);
        expect(policyLine(reply.content), `t${i + 1}: the policy came from the CA on file:\n${reply.content}`).not.toMatch(/late opening/i);
        expect(titleLine(reply.content), `t${i + 1}: the job title:\n${reply.content}`).toBe("Tanning Consultant");
      }
      untouched(t, before, calls);
    },
  },
  {
    id: "nov14-agent-loop-what-happened",
    title: `"create a coaching form for Rowan Kestrel" asks what happened with no Create; the account then gives a Coaching card with Create`,
    report: `${REPORT}; QA live r19 (10 Nov 2026), COACHING_ASKS_WHAT_HAPPENED / WHAT_HAPPENED_NO_CREATE`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      await finalizedOnFile(t, "Rowan Kestrel", "create a verbal ca for Rowan Kestrel, she was late on 10/26/26", "Observed:\nRowan Kestrel was late on 10/26/26.");
      const before = finalizedForms(t);
      const calls = t.calls();
      const thread = t.thread();
      const asked = await thread.say("create a coaching form for Rowan Kestrel");
      expect(asked.content, `the reply does not ask what happened:\n${asked.content}`).toMatch(/You haven't told me what happened yet/);
      expect(card(thread.proposal), `no Coaching card:\n${asked.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      expect(card(thread.proposal)?.supportsInlineDraft, "Create is offered while the reply asks what happened").toBe(false);
      const told = await thread.say("she skipped the closing checklist on her shift last night");
      expect(card(thread.proposal), `no Coaching card after the account:\n${told.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      expect(card(thread.proposal)?.supportsInlineDraft, "no Create once the account is given").toBe(true);
      expect(card(thread.proposal)?.locationId ?? null, `not NE Kearney:\n${told.content}`).toBe("loc-0309");
      expect(told.content, `the account went onto the finalized CA:\n${told.content}`).not.toMatch(/updated|revised|reopened/i);
      untouched(t, before, calls);
    },
  },
  ...(
    [
      ["coaching-and-cas", "are there any coaching and ca's for Jovelle Kerrigan"],
      ["named-library-question", "do we have a coaching form for Jovelle Kerrigan?"],
    ] as const
  ).map(([key, said]): ReplayCase => ({
    id: `nov14-agent-loop-sf-s29-${key}`,
    title: `sf-s29: "${said}", a finalized CA on file: answered from the forms on file — no card, no forms-library answer, the CA untouched`,
    report: `${REPORT}; Pau's overnight scan sf-s29 (5 Nov 2026)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
      t.directory([...STAFF, JOVELLE]);
      t.as("salon_director", KEARNEY);
      await finalizedOnFile(t, "Jovelle Kerrigan", "create a verbal ca for Jovelle Kerrigan, she was late on 10/26/26", "Observed:\nJovelle Kerrigan was late on 10/26/26.");
      const before = finalizedForms(t);
      const calls = t.calls();
      const thread = t.thread();
      const reply = await thread.say(said);
      expect(thread.proposal, `a form card for a question about forms on file:\n${reply.content}`).toBeNull();
      expect(reply.content, `the forms-library answer:\n${reply.content}`).not.toMatch(/I can create it here|is filed under|^Yes\. \*\*/);
      untouched(t, before, calls);
    },
  })),
  {
    id: "nov14-agent-loop-same-name",
    title: `"verbal CA for marnie holloway, she was late on 11/1/26" with two Marnie Holloways: asked which; the number picks the Assistant Salon Director; a finalized CA for the other untouched`,
    report: `${REPORT}; QA 12 Nov 2026 (SAME_NAME_ASKS_WHICH)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
      t.directory([...STAFF, SECOND_MARNIE]);
      t.as("salon_director", KEARNEY);
      await finalizedOnFile(t, "Remy Calder", "create a verbal ca for Remy Calder, she was late on 10/26/26", "Observed:\nRemy Calder was late on 10/26/26.");
      const before = finalizedForms(t);
      const calls = t.calls();
      const thread = t.thread();
      const asked = await thread.say("verbal CA for marnie holloway, she was late on 11/1/26");
      expect(asked.content, `not asked which Marnie Holloway:\n${asked.content}`).toMatch(/(?:Which person did you mean|Did you mean)[\s\S]*Marnie Holloway/);
      expect(titleLine(asked.content), `a title was chosen without asking:\n${asked.content}`).toBe("");
      // QA's bar for the loop ON: no Create before the person is chosen.
      if (t.loopActive?.()) expect(card(thread.proposal)?.supportsInlineDraft ?? false, "Create is offered before the person is chosen").toBe(false);
      const choice = /(\d+)\.\s*\*\*Marnie Holloway\*\*\s*\([^)]*Assistant Salon Director\)/.exec(asked.content);
      expect(choice, `no numbered choice for the Assistant Salon Director:\n${asked.content}`).toBeTruthy();
      const reply = await thread.say(choice![1]!);
      expect(card(thread.proposal), `not the Assistant Salon Director's card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Marnie Holloway", employeeRole: "Assistant Salon Director" });
      expect(card(thread.proposal)?.locationId ?? null, `not NE Kearney:\n${reply.content}`).toBe("loc-0309");
      expect(policyLine(reply.content), `not Attendance:\n${reply.content}`).toMatch(/attendance/i);
      untouched(t, before, calls);
    },
  },
  {
    id: "nov14-agent-loop-salon-not-a-person",
    title: `Admin: "CA for Brisa Talmadge, do not terminate yet, she was late" → offer → "KS Manhattan": the salon, never a person; the account and Attendance kept`,
    report: `${REPORT}; QA Sunny 37b (12 Nov 2026), OFF_ROSTER_PLACE_ANSWER`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
      t.directory([...STAFF]);
      t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
      await finalizedOnFile(t, "Marnie Holloway", "create a verbal ca for Marnie Holloway, she was late on 10/26/26", "Observed:\nMarnie Holloway was late on 10/26/26.");
      const before = finalizedForms(t);
      const calls = t.calls();
      const thread = t.thread();
      const first = await thread.say("CA for Brisa Talmadge, do not terminate yet, she was late");
      expect(first.content, `no off-roster offer:\n${first.content}`).toContain("reply **use Brisa Talmadge**");
      // QA's bar for the loop ON: no Create with no employee.
      const noCreateWithoutEmployee = () => {
        const shown = card(thread.proposal);
        if (t.loopActive?.() && shown && !shown.employeeName) expect(shown.supportsInlineDraft, "Create is offered with no employee").toBe(false);
      };
      noCreateWithoutEmployee();
      const reply = await thread.say("KS Manhattan");
      noCreateWithoutEmployee();
      expect(card(thread.proposal)?.templateKey, `no CA card:\n${reply.content}`).toBe("dpoa");
      expect(card(thread.proposal)?.employeeName ?? null, `"KS Manhattan" became the employee:\n${reply.content}`).toBeNull();
      expect(reply.content, `the salon is named as a person:\n${reply.content}`).not.toMatch(/\*\*Ks Manhattan\*\*/);
      expect(card(thread.proposal)?.locationId ?? null, `not KS Manhattan:\n${reply.content}`).toBe("loc-0462");
      expect(/\*\*Observation of Offense:\*\*\s*([^\n]*)/.exec(reply.content)?.[1]?.trim(), `the account was lost:\n${reply.content}`).toBe("do not terminate yet, she was late");
      expect(policyLine(reply.content), `the Attendance policy was lost:\n${reply.content}`).toMatch(/attendance/i);
      expect(reply.content, `"use Brisa Talmadge" not asked again:\n${reply.content}`).toContain("reply **use Brisa Talmadge**");
      untouched(t, before, calls);
    },
  },
];
