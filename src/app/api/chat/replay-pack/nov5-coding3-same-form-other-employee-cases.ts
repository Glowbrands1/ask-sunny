import { expect, vi } from "vitest";

import { KEARNEY, STAFF, noClaimWithoutUpdate, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "THE SAME FORM FOR ANOTHER EMPLOYEE" (coding3 groundwork, 5 Nov 2026)
 * ============================================================================
 *
 * Cases only: no fixFlags until a fix exists. The managers' turns are
 * verbatim; every person is invented (Mireya Vantrell, Caspian Drummet, Liora
 * Pellow, Teodric Sabrin). Extends, never repeats, the cases already here:
 *
 *   (a) "Can you do the same thing for <B> but switch it to a written" — QA's
 *       sf-s11 (`nov4-scan-sf-s11-same-for-another`) is the turn AFTER Create.
 *       Here: the same words with <A>'s card still on screen, not created —
 *       the intake path, not the open-form one.
 *   (b) "can you create the same draft that we did with <C> by changing the
 *       name and position?" — `nov3-stepb-copy-keeps-details` and
 *       `same-form-copy-e2e.test.ts` cover it with the NEW person's draft open
 *       (the copy target). Here: <C>'s own draft is the one open, the new
 *       person not named yet, as the words say ("changing the name").
 *   (c) The sibling app (the same code): with <A>'s Corrective Action card
 *       open, "also make a coaching form for <B>" gave a Coaching card for
 *       <A>. Since production-flags.json was matched to Vercel (#555),
 *       FORM_TYPE_SWITCH_ENABLED and FORM_TYPE_SWITCH_AFTER_CREATE_NOTE_ENABLED
 *       are on here too, so these cases are OPEN here as well
 *       (`lib/ai/form-type-switch.ts` reads the short "make … coaching" turn
 *       as "change this to a coaching form" and drops the name).
 */

type T = ReplayContext;

const SALON = "loc-0309";
const person = (id: string, firstName: string, lastName: string, positionName = "Tanning Consultant"): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: [SALON],
  positionName,
});

const MIREYA = person("e-mireya-vantrell", "Mireya", "Vantrell");
const CASPIAN = person("e-caspian-drummet", "Caspian", "Drummet");
const LIORA = person("e-liora-pellow", "Liora", "Pellow");
/** Another position than Liora's: "changing the name and position" — his own, never hers. */
const TEODRIC = person("e-teodric-sabrin", "Teodric", "Sabrin", "Assistant Salon Director");

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function coding3SameFormPeople(): readonly DirectoryRow[] {
  return [MIREYA, CASPIAN, LIORA, TEODRIC];
}

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  t.directory([...STAFF, MIREYA, CASPIAN, LIORA, TEODRIC]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

/** The warning level the card carries (the pack's answer type leaves it out). */
function warningLevel(card: ReplayAnswer["formProposal"] | null | undefined): string | null {
  return (card as { warningLevel?: string | null } | null | undefined)?.warningLevel ?? null;
}

const MIREYA_VERBAL = "I need a verbal corrective action for Mireya Vantrell, she was late opening the salon on Monday";
const MIREYA_CA = "I need a corrective action for Mireya Vantrell, she was late opening the salon on Monday";
const LIORA_DETAILS =
  "Observed: Liora Pellow leaves the tanning beds unwiped between guests.\nExpectation: Liora wipes every bed with the approved cleaner before the next guest.";
const SAME_DRAFT = "can you create the same draft that we did with Liora Pellow by changing the name and position?";

/** Liora's Coaching Form, created in this chat with its Details; her draft stays open. */
async function lioraDraft(t: T, thread: ReturnType<T["thread"]>): Promise<string> {
  await thread.say("create a coaching form for Liora Pellow");
  expect(thread.proposal, "no Coaching card for Liora Pellow").toMatchObject({ templateKey: "coaching", employeeName: "Liora Pellow" });
  t.draftWrites({ coaching_details: LIORA_DETAILS });
  const id = await thread.create();
  expect(t.values(id).coaching_details ?? "").toMatch(/approved cleaner/);
  return id;
}

const REPORT_A = "QA's overnight scan of production chats, 4 Nov 2026, sf-s11: \"Can you do the same thing for <B> but switch it to a written\"";
const REPORT_B = "Location manager via QA (the sibling app's replay set b13; the same code here): \"can you create the same draft that we did with <C> by changing the name and position?\"";
const REPORT_C = "QA, 5 Nov 2026 (the sibling app's production; the same code here): with <A>'s Corrective Action card open, \"also make a coaching form for <B>\" gave a Coaching card for <A>";

export const NOV5_CODING3_SAME_FORM_OTHER_EMPLOYEE_CASES: readonly ReplayCase[] = [
  {
    id: "nov5-coding3-sfo-a-same-thing-card-on-screen",
    title: "(a) with Mireya's Verbal CA card on screen (not created), \"Can you do the same thing for Caspian Drummet but switch it to a written\" — a Written CA card for Caspian with the late opening, nothing of Mireya on it",
    report: `${REPORT_A}; the same words before Create`,
    // Run 5 Nov 2026 (production flags): the card stays Mireya Vantrell, Verbal, and the request sentence is added to its Observation of Offense.
    status: { open: "the card stays Mireya Vantrell's Verbal CA and the request sentence is added to its Observation of Offense; no card for Caspian Drummet" },
    async run(t) {
      const thread = start(t);
      await thread.say(MIREYA_VERBAL);
      expect(thread.proposal, "turn 1 made no CA card for Mireya Vantrell").toMatchObject({ templateKey: "dpoa", employeeName: "Mireya Vantrell" });
      const reply = await thread.say("Can you do the same thing for Caspian Drummet but switch it to a written");
      expect(reply.formProposal, `no card for Caspian Drummet:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Caspian Drummet" });
      expect(warningLevel(reply.formProposal), "Caspian's card is not a Written Warning").toBe("written");
      expect(reply.content, "Caspian's card lost the late opening").toMatch(/late opening/i);
      expect(reply.content, "Mireya is on Caspian's card").not.toMatch(/mireya|vantrell/i);
      expect(reply.content, "the request sentence is on the card").not.toMatch(/do the same thing|switch it to a written/i);
    },
  },
  {
    id: "nov5-coding3-sfo-b-same-draft-own-draft-open",
    title: "(b) with Liora's own Coaching draft open, \"can you create the same draft that we did with Liora Pellow by changing the name and position?\" — never a card for Liora, her draft untouched",
    report: `${REPORT_B}; Liora's own draft open, the new person not named yet`,
    // Run 5 Nov 2026 (production flags): INTENT_EXTRACTION_ENABLED reads the turn as a Coaching request for Liora — a second card for her.
    status: { open: "a second Coaching card for Liora Pellow (the form to copy FROM): the copy finds no source but the open draft's own person, and the intent reader makes the turn a new request for her" },
    async run(t) {
      const thread = start(t);
      const liora = await lioraDraft(t, thread);
      const before = JSON.stringify(t.values(liora));
      const reply = await thread.say(SAME_DRAFT);
      expect(reply.formProposal?.employeeName ?? null, `a card for Liora Pellow, the draft to copy from:\n${reply.content}`).not.toBe("Liora Pellow");
      expect(reply.formUpdate?.instanceId ?? null, "Liora's draft is written over").not.toBe(liora);
      expect(JSON.stringify(t.values(liora)), "Liora's draft changed").toBe(before);
      noClaimWithoutUpdate(reply);
    },
  },
  {
    id: "nov5-coding3-sfo-b-same-draft-then-name-copies",
    title: "(b) \"can you create the same draft that we did with Liora Pellow by changing the name and position?\" → \"Teodric Sabrin\" → Create: Teodric's draft carries Liora's Details, his name and his own position",
    report: `${REPORT_B}; then the new person's name, then Create`,
    // Run 5 Nov 2026 (production flags): Teodric's card comes, but Create drafts it from "Teodric Sabrin" alone — Liora's Details are not copied.
    status: { open: "Teodric Sabrin's created draft has none of Liora Pellow's Details: Create copies only when the card's own request turn asks for \"the same draft\"" },
    async run(t) {
      const thread = start(t);
      const liora = await lioraDraft(t, thread);
      await thread.say(SAME_DRAFT);
      const reply = await thread.say("Teodric Sabrin");
      expect(reply.formProposal, `no Coaching card for Teodric Sabrin:\n${reply.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Teodric Sabrin" });
      t.draftWrites({ coaching_details: "Observed:\nCoaching for Teodric Sabrin." });
      const teodric = await thread.create();
      expect(teodric, "Teodric's form is Liora's").not.toBe(liora);
      const values = t.values(teodric);
      expect(values.employee_name).toBe("Teodric Sabrin");
      expect(values.job_title, "Teodric's form carries Liora's position").toBe("Assistant Salon Director");
      expect(values.coaching_details ?? "", "Liora's Details were not copied onto Teodric's draft").toMatch(/approved cleaner/);
      expect(values.coaching_details ?? "", "the copied Details still name Liora").not.toMatch(/liora|pellow/i);
      expect(t.values(liora).coaching_details ?? "", "Liora's own draft changed").toMatch(/Liora Pellow leaves the tanning beds/);
    },
  },
  {
    id: "nov5-coding3-sfo-c-also-coaching-card-open",
    title: "(c) with Mireya's CA card on screen (not created), \"also make a coaching form for Caspian Drummet\" — a Coaching card for Caspian, never for Mireya",
    report: `${REPORT_C}; the card not created yet`,
    // Was "fixed" on 5 Nov 2026 with the old flag file; FORM_TYPE_SWITCH_ENABLED is on in production since #555's reading (as in the sibling app), so it is OPEN here too.
    status: { open: "the Coaching card is Mireya Vantrell's: the form-type switch reads the turn as \"change this to coaching\" and drops Caspian Drummet" },
    async run(t) {
      const thread = start(t);
      await thread.say(MIREYA_CA);
      expect(thread.proposal, "turn 1 made no CA card for Mireya Vantrell").toMatchObject({ templateKey: "dpoa", employeeName: "Mireya Vantrell" });
      const reply = await thread.say("also make a coaching form for Caspian Drummet");
      expect(reply.formProposal, `the Coaching card is not Caspian Drummet's:\n${reply.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Caspian Drummet" });
      expect(reply.content, "Mireya is on Caspian's card").not.toMatch(/mireya|vantrell/i);
      t.draftWrites({ coaching_details: "Observed:\nCoaching for Caspian Drummet." });
      const caspian = await thread.create();
      expect(t.values(caspian).employee_name).toBe("Caspian Drummet");
      expect(t.forms().filter((row) => row.employee_name === "Mireya Vantrell" && row.template_key === "coaching"), "a Coaching Form for Mireya").toEqual([]);
    },
  },
  {
    id: "nov5-coding3-sfo-c-also-coaching-after-create",
    title: "(c) with Mireya's CA created and open, \"also make a coaching form for Caspian Drummet\" — a Coaching card for Caspian; Mireya's CA untouched",
    report: `${REPORT_C}; after Create`,
    // Was "fixed" on 5 Nov 2026 with the old flag file; FORM_TYPE_SWITCH_AFTER_CREATE_NOTE_ENABLED is on in production since #555's reading (as in the sibling app), so it is OPEN here too.
    status: { open: "the Coaching card is Mireya Vantrell's: the switch-after-create note swaps in her opening request and drops Caspian Drummet" },
    async run(t) {
      const thread = start(t);
      await thread.say(MIREYA_CA);
      t.draftWrites({ observation: "Observed:\nMireya Vantrell opened the salon late on Monday." });
      const mireya = await thread.create();
      const before = JSON.stringify(t.values(mireya));
      const reply = await thread.say("also make a coaching form for Caspian Drummet");
      expect(reply.formProposal, `the Coaching card is not Caspian Drummet's:\n${reply.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Caspian Drummet" });
      expect(reply.formUpdate?.instanceId ?? null, "Mireya's CA is written over").not.toBe(mireya);
      expect(JSON.stringify(t.values(mireya)), "Mireya's CA changed").toBe(before);
      t.draftWrites({ coaching_details: "Observed:\nCoaching for Caspian Drummet." });
      const caspian = await thread.create();
      expect(caspian).not.toBe(mireya);
      expect(t.values(caspian).employee_name).toBe("Caspian Drummet");
      expect(t.forms().filter((row) => row.employee_name === "Mireya Vantrell" && row.template_key === "coaching"), "a Coaching Form for Mireya").toEqual([]);
    },
  },
];
