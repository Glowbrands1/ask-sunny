import { formEditToolInStreamEnabled } from "@/lib/config/chat-quality-flags";
import { expect, vi } from "vitest";

import { PAYROLL_AMOUNT_QUESTION } from "@/lib/forms/payroll-amount-field";

import { KEARNEY, STAFF, replyMatchesDiff, savedForm, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayThread } from "./cases";

/*
 * STEP B'S CASES (3 Nov 2026), ported from Ask Bubbles (d130fa40, 618bed02):
 * the mechanism of each report, in this app's own setting (salons, salon
 * titles, invented people). One form-update path (FORM_PATCH_REDUCER_ENABLED +
 * FORM_REPLY_FROM_DIFF_ENABLED, same flags in both apps): what the manager
 * says in chat reaches the open draft's fields, a typed field is never
 * blanked, a redraft merges, payroll and dates go in exactly as given, and the
 * reply about the form comes only from what really changed. Each case asserts
 * that invariant on what is SAVED and what is CLAIMED. The flags are off in
 * production; with both on, every case but the date case must hold
 * (`fixFlags`).
 *
 * THE FORM-PATCH MODEL IS SCRIPTED (`t.patchWrites`): its raw output for each
 * call, in order, with the manager's own words as the evidence. A call past
 * the script falls back, and that turn runs on the old path. The zod parse,
 * the evidence checks, the reducer, the writes and the reload are real.
 *
 * The drafting and revision models are left at the pack's defaults (they
 * write nothing) unless a case says otherwise: the drafting model was never
 * handed the details (its prompt held only the turns before the card), and
 * the revision model wrote nothing the manager asked for.
 */

const PEOPLE: DirectoryRow[] = [
  ...STAFF,
  { id: "hr-pat", firstName: "Pat", lastName: "Rivera", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
  // A second Juno on the roster: the Daily Stats edit names a coworker whose first name two people share.
  { id: "live-juno-2", firstName: "Juno", lastName: "Wexley", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
];

/**
 * One turn on the open draft: the reply may say the form changed only when the
 * saved values (text or ticked options) did change — `replyMatchesDiff`.
 */
async function turnOnDraft(t: Parameters<ReplayCase["run"]>[0], thread: ReplayThread, id: string, text: string): Promise<ReplayAnswer> {
  const before = savedForm(t, id);
  const reply = await thread.say(text);
  replyMatchesDiff(t, id, before, reply, text);
  return reply;
}

/** One scripted form-patch output: what the latest message is, and what it adds to each field, in the manager's words. */
function patchOutput(turn: "this_form" | "question" | "other", set: readonly { field: string; value: string; how?: "add" | "replace"; evidence?: string }[] = []) {
  return {
    turn,
    set: set.map((entry) => ({ field: entry.field, value: entry.value, how: entry.how ?? "add", evidence: entry.evidence ?? entry.value })),
    clear: [],
  };
}

/** Every way a date can be written on a form: 10-1-26, 10/01/2026, 2026-10-01, October 1, 2026, Oct 1. */
const DATE_SHAPES =
  /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi;
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "10-1-26" → "10-01"; "2026-10-01" → "10-01"; "October 1, 2026" → "10-01" (month and day only; the year is checked by the Date field). */
function monthDay(text: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return `${iso[2]}-${iso[3]}`;
  const numeric = /^(\d{1,2})[-/](\d{1,2})/.exec(text);
  if (numeric) return `${numeric[1]!.padStart(2, "0")}-${numeric[2]!.padStart(2, "0")}`;
  const named = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})/i.exec(text);
  const month = named ? MONTH_NAMES.indexOf(named[1]!.toLowerCase()) : -1;
  return month < 0 ? null : `${String(month + 1).padStart(2, "0")}-${named![2]!.padStart(2, "0")}`;
}

/** Step B's two flags, both on: the fix this file's cases are run with. */
const STEP_B_FLAGS = ["FORM_PATCH_REDUCER_ENABLED", "FORM_REPLY_FROM_DIFF_ENABLED"];

/** What Rowan did, in the b17 mechanism's wording here. */
const ROWAN_DID = "rowan marked a session as complete but the guest hadn't been sprayed yet";

export const NOV3_STEP_B_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-stepb-copy-keeps-details",
    title: "\"ok, create the draft, but include the details of the cleaning checklist.\" — the copied draft holds the checklist details she gave",
    report:
      'Ask Bubbles replay set b13, the mechanism here: "can you create the same draft that we did with <name> by changing the name and position?" → "ok, create the draft, but include the details of <the process>." — the new draft had none of the details',
    // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: STEP_B_FLAGS,
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const details =
        "this is what i am wanting to coach on: closing the tanning rooms, here are the details of the process: wipe the bed with the approved cleaner, use the cleaning checklist and initial each room in order of last guest first. Restock lotion samples, fold towels, once the room is ready, then mark it clean on the check-in screen.";
      const process =
        "wipe the bed with the approved cleaner, use the cleaning checklist and initial each room in order of last guest first. Restock lotion samples, fold towels, once the room is ready, then mark it clean on the check-in screen.";
      t.patchWrites([
        // The details she gave, on Marnie's open draft.
        patchOutput("this_form", [{ field: "coaching_details", value: process }]),
        // "add details about the cleaning checklist": the checklist step, already there.
        patchOutput("this_form", [{ field: "coaching_details", value: "use the cleaning checklist and initial each room in order of last guest first" }]),
        // Juno, and copying Marnie's draft: another person, not this form.
        patchOutput("other"),
        patchOutput("other"),
        patchOutput("other"),
      ]);
      const thread = t.thread();
      for (const turn of ["Create a coaching form.", "for whole staff - tanning consultants", "Marnie", "yes"]) await thread.say(turn);
      /*
       * The copy is asked for before Juno is named (Ask Bubbles' report named
       * the new person first). Here, naming Marnie in a turn after Juno's card
       * was shown puts Marnie's card back on screen — the card's reading of
       * names, outside Step B (docs/parity-log/2026-11-03-step-b-form-patch.md).
       *
       * "the same draft that we did with marnie holloway": her draft was made,
       * so the pack presses Create on her card, as the manager did. The
       * details then go to Marnie's open draft, and Juno's is copied from it.
       */
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", employeeName: "Marnie Holloway" });
      const marnie = await thread.create();
      for (const turn of [
        details,
        "add details about the cleaning checklist",
        "can you create the same draft that we did with marnie holloway by changing the name and position?",
        "Do the same coaching form for juno paxton",
        "ok, create the draft, but include the details of the cleaning checklist.",
      ]) {
        await thread.say(turn);
      }
      expect(t.values(marnie).coaching_details ?? "", "Marnie's draft does not hold the details she gave").toMatch(/cleaning checklist/i);
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", employeeName: "Juno Paxton" });
      const juno = await thread.create();
      const copied = t.values(juno).coaching_details ?? "";
      expect(copied, "Juno's draft does not hold the cleaning-checklist details").toMatch(/cleaning checklist/i);
      expect(copied, "Juno's draft does not hold the room order, last guest first").toMatch(/last guest first/i);
    },
  },
  {
    id: "nov3-stepb-make-that-update",
    title: "\"make that update\" and \"I need to add that the room …\" reach the team draft's Details, and no reply says updated without a change",
    report:
      'Ask Bubbles replay set b15 (rated 3), the mechanism here: "i don\'t see the details updated in the draft card. Do i need to copy and paste it? or should it be automatically updating?" → "make that update" → … → "the changes weren\'t made in the details"',
    // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: STEP_B_FLAGS,
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const flow =
        "coaching is on room turnover for clean organization and flow.  Our district manager has flagged our salon due to marking rooms ready within 0 minutes of the guest checking out.  So we are implementing a new flow.  when a guest checks out, the room will be logged on the turnover clipboard, in order of checkout, then those rooms will be cleaned in order, and the bed wiped and the towels replaced, once rooms are all cleaned, the clipboard will go back to the front desk, initialed, and then mark the rooms ready.   Then, the next round of checkouts will be logged in order on the clipboard.";
      const rule = "the room must not be marked ready until 10 minutes has passed form the guest checking out.";
      t.patchWrites([
        // The flow, added to the open team draft's Details.
        patchOutput("this_form", [{ field: "coaching_details", value: flow }]),
        // "this is perfect": nothing for the form.
        patchOutput("other"),
        // "i don't see the details updated …" and "can i reopen this for an edit?" are questions: no patch call (QUESTION_NOT_FORM).
        // "make that update": the flow again — already there, so nothing changes, and the reply says so.
        patchOutput("this_form", [{ field: "coaching_details", value: flow }]),
        // "I need to add that …": the 10-minute rule, added.
        patchOutput("this_form", [{ field: "coaching_details", value: rule }]),
        // "the changes weren't made in the details": a complaint, nothing new.
        patchOutput("question"),
      ]);
      const thread = t.thread();
      await thread.say("can you create a coaching form for my whole staff?");
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", subject: "team" });
      const id = await thread.create();
      for (const turn of [
        flow,
        "this is perfect",
        "i don't see the details updated in the draft card.  Do i need to copy and paste it?  or should it be automatically updating?",
        "make that update",
      ]) {
        await turnOnDraft(t, thread, id, turn);
      }
      expect(t.values(id).coaching_details ?? "", 'after "make that update" the Details do not hold the new flow').toMatch(/turnover clipboard/i);
      for (const turn of ["can i reopen this for an edit?", `I need to add that ${rule}`, "the changes weren't made in the details"]) {
        await turnOnDraft(t, thread, id, turn);
      }
      expect(t.values(id).coaching_details ?? "", "the 10-minute rule is not in the Details").toMatch(/room must not be marked ready until 10 minutes/i);
      expect(t.values(id).coaching_details ?? "", "adding the 10-minute rule dropped the flow").toMatch(/turnover clipboard/i);
    },
  },
  {
    id: "nov3-stepb-write-the-observation",
    title: "\"yes, do that\" / \"write the observtion\" put what Rowan did on the draft, and no reply says updated without a change",
    report:
      'Ask Bubbles replay set b17 (rated 2), the mechanism here: "<name> marked <a thing> as <done> but <it wasn\'t>" → "yes, do that" → "it didnt edit in the card" → "the details we just discussed!!!" → "write the observtion"',
    // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: STEP_B_FLAGS,
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const topic = "spray tan booth, when to press start session and when to press session complete";
      t.patchWrites([
        patchOutput("this_form", [{ field: "coaching_details", value: topic }]),
        // "can you upate the draft with these details of coaching?": what she already said, already there.
        patchOutput("this_form", [{ field: "coaching_details", value: topic }]),
        patchOutput("this_form", [{ field: "coaching_details", value: ROWAN_DID }]),
        // "yes, do that": what she already said, already on the draft.
        patchOutput("this_form", [{ field: "coaching_details", value: ROWAN_DID }]),
        // "it didnt edit in the card": a complaint, nothing new.
        patchOutput("other"),
        // "the details we just discussed!!!", "write the observtion": the same sentence, already there.
        patchOutput("this_form", [{ field: "coaching_details", value: ROWAN_DID }]),
        patchOutput("this_form", [{ field: "coaching_details", value: ROWAN_DID }]),
      ]);
      const thread = t.thread();
      for (const turn of ["Create a coaching form.", "Rowan", "yes"]) await thread.say(turn);
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      const id = await thread.create();
      for (const turn of [topic, "can you upate the draft with these details of coaching?", ROWAN_DID, "yes, do that"]) {
        await turnOnDraft(t, thread, id, turn);
      }
      const said = /rowan marked a session as complete but the guest hadn't been sprayed yet/i;
      expect(t.values(id).coaching_details ?? "", 'after "yes, do that" the draft does not say what Rowan did').toMatch(said);
      for (const turn of ["it didnt edit in the card", "the details we just discussed!!!", "write the observtion"]) {
        await turnOnDraft(t, thread, id, turn);
      }
      expect(t.values(id).coaching_details ?? "", 'after "write the observtion" the draft does not say what Rowan did').toMatch(said);
    },
  },
  {
    id: "nov3-stepb-invented-sentence-refused",
    title: "a patch that mixes an invented sentence with some of the manager's real words is refused, and nothing is saved",
    report:
      "QA, 3 Nov 2026 (Step B review, both apps): the model's value must be the manager's words, not only its evidence. In the b17 mechanism's wording here, what Rowan did, written up as something she never said",
    // Nothing is written in production either (the revision model writes nothing); with Step B the reducer refuses it.
    status: "fixed",
    fixFlags: STEP_B_FLAGS,
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      /*
       * The half-the-words rule (MIN_SAID_SHARE) is a floor, not proof that a
       * sentence was said. Here it holds: the invented value reuses fewer than
       * half of its words from her ("rowan marked a session as complete",
       * "the", "guest"), so it is refused although its evidence is her exact
       * words.
       */
      const invented =
        "rowan marked a session as complete and then argued with the guest about it, refused to apologise, and was rude to the salon team all week";
      t.patchWrites([
        patchOutput("this_form", [{ field: "coaching_details", value: invented, evidence: ROWAN_DID }]),
        // "write the observtion": her own sentence, which is written.
        patchOutput("this_form", [{ field: "coaching_details", value: ROWAN_DID }]),
      ]);
      const thread = t.thread();
      for (const turn of ["Create a coaching form.", "Rowan", "yes"]) await thread.say(turn);
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      const id = await thread.create();
      const before = savedForm(t, id);
      const reply = await turnOnDraft(t, thread, id, ROWAN_DID);
      expect(savedForm(t, id), "the invented sentence was saved").toBe(before);
      expect(t.values(id).coaching_details ?? "", "the invented sentence reached the Details").not.toMatch(/argued with the guest|rude to the salon team/i);
      expect(reply.formUpdate, "the reply says the form changed").toBeUndefined();
      if (t.calls().patch > 0) {
        // Step B: the same model call, with her words as the value, is written.
        await turnOnDraft(t, thread, id, "write the observtion");
        /*
         * FORM_EDIT_TOOL_IN_STREAM_ENABLED (Step 3, ported from Ask Bubbles;
         * classification 4 Nov 2026): the same reading arrives as an edit_form
         * call, whose ops carry no evidence — the one writer's tool preset
         * counts only the latest message ("write the observtion"), so her
         * earlier sentence is refused (not_in_manager_words) and the turn goes
         * to the old chain, which writes nothing here, as in production today.
         * Still nothing invented.
         */
        if (formEditToolInStreamEnabled()) {
          expect(t.values(id).coaching_details ?? "").not.toMatch(/argued with the guest/i);
          return;
        }
        expect(t.values(id).coaching_details ?? "", "her own sentence was not written").toMatch(/rowan marked a session as complete but the guest hadn't been sprayed yet/i);
        expect(t.values(id).coaching_details ?? "").not.toMatch(/argued with the guest/i);
      }
    },
  },
  {
    id: "nov3-stepb-daily-stats-edit",
    title: "\"Add that she Must Practice the sanitizing checklist every shift with Juno before Daily Stats.\" edits the open Coaching Form — no knowledge answer, no new card",
    report:
      "QA's live production test, 3 Nov 2026 (both apps): with a Coaching Form open, \"Add that she Must Practice the sanitizing checklist every shift with <coworker> before Daily Stats.\" left the saved form unchanged; here it offered a NEW proposal card instead of an edit",
    /*
     * BEHAVIOUR DIFFERENCE FROM ASK BUBBLES (docs/parity-log/2026-11-03-step-b-form-patch.md):
     * in Ask Bubbles the turn fell through to the knowledge answer. Here,
     * with production's flags, "Juno" is read as a person on the roster (two
     * people share the first name, so the roster gate keeps it as a name):
     * the revision (`chat-revision.ts`, its roster name gate) and the
     * open-draft turn (`open-draft-turn.ts`) both return null, and the turn
     * reaches `answerQuestion`, whose card intake reads "Add that …" as an
     * edit of the card still in the thread (FORM_EDIT_DATE_RULES_ENABLED,
     * `ai/edit-date-rules.ts`: "Added to **Observation of Offense**, in your
     * words: …") and offers a NEW proposal card for Marnie, no model answer
     * called — the open draft unchanged under a reply that says "Added". That
     * path is the last in the cascade; the patch turn runs before the
     * redraft, the revision, the open-draft turn and `answerQuestion`, so with
     * the flag on the model reads the turn as this form's and it is written.
     * With the flag off the order of the paths is unchanged.
     */
    // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: STEP_B_FLAGS,
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const said = "Add that she Must Practice the sanitizing checklist every shift with Juno before Daily Stats.";
      const sentence = "she Must Practice the sanitizing checklist every shift with Juno before Daily Stats.";
      t.patchWrites([patchOutput("this_form", [{ field: "coaching_details", value: sentence }])]);
      const thread = t.thread();
      for (const turn of ["Create a coaching form.", "Marnie", "yes"]) await thread.say(turn);
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", employeeName: "Marnie Holloway" });
      const id = await thread.create();
      const reply = await turnOnDraft(t, thread, id, said);
      expect(reply.formProposal, "the edit offered a new card").toBeUndefined();
      expect(t.values(id).coaching_details ?? "", "the sentence is not on the form").toMatch(/sanitizing checklist every shift with Juno before Daily Stats/i);
      expect(reply.formUpdate?.updated, "the reply is not the saved diff").toEqual(["coaching_details"]);
      expect(reply.content, "the reply is not the saved diff").toMatch(/^Changed Details of Coaching to "/);
    },
  },
  {
    id: "nov3-stepb-position-not-a-topic",
    title: "the employee's position and salon (\"Tanning Consultant at Kearney\") is never written into a topic or the Other topic",
    report:
      "QA's live production test, 3 Nov 2026, in both apps: the person's position and location (\"<position> at <location>\") was written into the draft's Other topic",
    /*
     * Step B's draft write (`reduceDraftWrite`) leaves out a drafted text that
     * only restates the form's header — the position with the salon or the
     * name, read from the form's own Job Title and Location (the roster's),
     * not from a word list — and unticks the box that line is the write-in
     * of (the template's own layout: the line after the group, labelled like
     * one of its options).
     */
    // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: STEP_B_FLAGS,
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      // What the drafting model wrote live: Other ticked, and the position and salon as its topic.
      t.draftWrites({ other_topic: "Tanning Consultant at Kearney" }, { coaching_topics: ["other"] });
      const thread = t.thread();
      for (const turn of ["Create a coaching form.", "Marnie", "yes"]) await thread.say(turn);
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", employeeName: "Marnie Holloway" });
      const id = await thread.create();
      const values = t.values(id);
      // Her position is on the roster ("Tanning Consultant") and on the form's Job Title line; her salon on its Location line.
      expect(values.job_title).toBe("Tanning Consultant");
      expect(t.checked(id).coaching_topics ?? [], "Other is ticked with nothing beside it").not.toContain("other");
      for (const key of ["other_topic", "coaching_details"]) {
        expect(values[key] ?? "", `${key} holds her position`).not.toMatch(/tanning consultant/i);
        expect(values[key] ?? "", `${key} holds her salon`).not.toMatch(/kearney/i);
      }
    },
  },
  {
    id: "nov3-stepb-typed-add-stays-the-managers",
    title: "an \"add\" to a line the manager typed stays hers: a later redraft keeps both what she typed and what she added",
    report:
      "QA's ruling on Step B, 3 Nov 2026 (option A, both apps): text added in chat to a field the manager typed is written as hers, so a redraft cannot replace her words",
    // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: STEP_B_FLAGS,
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const typed = "Rowan was coached on the spray tan booth: start session versus session complete.";
      t.patchWrites([patchOutput("this_form", [{ field: "coaching_details", value: ROWAN_DID }])]);
      const thread = t.thread();
      for (const turn of ["Create a coaching form.", "Rowan", "yes"]) await thread.say(turn);
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      const id = await thread.create();
      t.typeOnForm(id, { coaching_details: typed });
      await turnOnDraft(t, thread, id, `add that ${ROWAN_DID}`);
      const added = t.values(id).coaching_details ?? "";
      expect(added, "her typed line was lost").toContain(typed);
      expect(added, "the add was not written").toContain(ROWAN_DID);
      // A later redraft, whose drafting model rewrites the Details.
      t.draftWrites({ coaching_details: "Observed:\nRowan needs to learn the spray tan booth screens." });
      await t.redraft(id, `Create a coaching form for Rowan Kestrel.\nadd that ${ROWAN_DID}`);
      const after = t.values(id).coaching_details ?? "";
      expect(after, "the redraft replaced what she typed").toContain(typed);
      expect(after, "the redraft replaced what she added").toContain(ROWAN_DID);
      expect(after, "the redraft's text replaced hers").not.toContain("needs to learn the spray tan booth screens");
    },
  },
  ...(["make it sound more professional", "can you make it more professional"] as const).map(
    (wording): ReplayCase => ({
      id: `nov3-stepb-wording-only-revision-${wording.startsWith("can") ? "can-you" : "make-it"}`,
      title: `"${wording}" rewrites the open draft: a patch that sets nothing hands the turn to the revision`,
      report: `QA, 3 Nov 2026 (blocker before the Step B flip, ported from Ask Bubbles): "${wording}" — the patch model reads it as about this form but sets nothing; the reply was "I didn't change anything on the form." and the revision never ran`,
      status: "fixed",
      fixFlags: STEP_B_FLAGS,
      async run(t) {
        t.directory(PEOPLE);
        t.as("salon_director", KEARNEY);
        const plain = "Marnie was out of dress code three shifts in a row.";
        const polished = "Marnie did not follow the dress code on three consecutive shifts.";
        t.draftWrites({ coaching_details: plain });
        t.patchWrites([patchOutput("this_form")]);
        t.revisionWrites({ coaching_details: polished });
        const thread = t.thread();
        await thread.say("Create a coaching form for Marnie Holloway, she was out of dress code three shifts in a row");
        expect(thread.proposal).toMatchObject({ templateKey: "coaching", employeeName: "Marnie Holloway" });
        const id = await thread.create();
        const reply = await turnOnDraft(t, thread, id, wording);
        expect(t.values(id).coaching_details ?? "", "the revision never ran: the Details were not rewritten").toBe(polished);
        expect(reply.content, "the reply says nothing changed though the Details were rewritten").not.toMatch(/didn't change anything/i);
      },
    }),
  ),
  {
    id: "nov3-stepb-true-claim-keeps-guidance",
    title: "a correction that really changed the form keeps its own reply, the payroll amount question included, word for word",
    report:
      "QA's ruling on Step B, 3 Nov 2026 (both apps): a path's guidance is never dropped when its claim is true — \"payroll deduct applies\" on an open Corrective Action asks for the amount",
    status: "fixed",
    fixFlags: STEP_B_FLAGS,
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create ca form for pat rivera for a register shortage on 10-20-26.");
      expect(thread.proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Pat Rivera" });
      const id = await thread.create();
      const reply = await turnOnDraft(t, thread, id, "payroll deduct applies");
      expect(t.checked(id).payroll_deduct, "payroll deduct is not saved as Yes").toEqual(["yes"]);
      expect(reply.formUpdate?.updated ?? [], "the reply does not claim the payroll answer").toContain("payroll_deduct");
      expect(reply.content, "the amount question was dropped").toContain(PAYROLL_AMOUNT_QUESTION);
    },
  },
  {
    id: "nov3-stepb-payroll-as-given",
    title: "\"payroll deduct applies and $3.25 will be deducted from check\" — Yes, $3.25 exactly in its own field, and the Action Plan the AI writes may carry the payroll sentence",
    report:
      'HR, 21 Oct 2026: "create ca form for pat rivera for a register shortage on 10-20-26. payroll deduct applies and $3.25 will be deducted from check."',
    /*
     * EXPECTATION CHANGED ON PURPOSE — Pau 5 Nov 2026: the AI writes the Action Plan;
     * ACTION_PLAN_MANAGER_ONLY off in production. This case used to assert a manager-only
     * plan without the deduction, on the belief that ACTION_PLAN_MANAGER_ONLY_ENABLED was on
     * here (QA's Vercel read, 5 Nov 2026: it is off in both apps). The plan the AI builds may
     * carry PLAN_PAYROLL_SENTENCE's "<name> will be payroll deducted $3.25.", as in Ask
     * Bubbles; the $3.25 still goes to the Payroll deduction amount field verbatim.
     */
    status: "fixed",
    fixFlags: STEP_B_FLAGS,
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create ca form for pat rivera for a register shortage on 10-20-26. payroll deduct applies and $3.25 will be deducted from check.");
      expect(thread.proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Pat Rivera" });
      const id = await thread.create();
      // The Yes/No group is saved as a ticked option: `t.checked` reads it.
      expect(t.checked(id).payroll_deduct, "payroll deduct is not saved as Yes").toEqual(["yes"]);
      const values = t.values(id);
      expect(values.payroll_deduct_amount, "the amount is not $3.25 as given").toBe("$3.25");
      // Pau 5 Nov 2026: the AI writes the Action Plan; ACTION_PLAN_MANAGER_ONLY off in production. Any $3.25 in it is PLAN_PAYROLL_SENTENCE's sentence.
      for (const amount of (values.action_plan ?? "").match(/\$\d+(?:[.,]\d+)*/g) ?? []) expect(amount, "the Action Plan names an amount she did not give").toBe("$3.25");
      expect(JSON.stringify(values), "an amount she did not give is on the form").not.toMatch(/\$(?!3\.25\b)\d/);
    },
  },
  {
    id: "nov3-stepb-date-as-given",
    title: "the incident date \"on 10-1-26\" is the form's Date, written once, and no other date is invented",
    report:
      'HR, 21 Oct 2026: the form "repeated the date of the offense" and "used 10-21-26 instead of 10-1-26"',
    /*
     * NOT FIXED BY STEP B, and left without fixFlags, as in Ask Bubbles. The
     * second "10-1-26" is the Observation's own text: in production the
     * drafting model's sentence, here (the pack's model writes nothing) the
     * draft route's never-blank fallback, which quotes the manager's words.
     * Step B merges fields; it does not rewrite a sentence.
     */
    status: { open: "the incident date is written twice: the Date field and again in the Observation (\"… on 10-1-26\")" },
    async run(t) {
      // HR's report was written on 21 Oct 2026; "today" must not leak onto the form.
      vi.setSystemTime(new Date("2026-10-21T15:30:00Z"));
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create verbal ca for pat rivera, she was late to salon 15 minutes on 10-1-26. no payroll deduct");
      expect(thread.proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Pat Rivera" });
      const id = await thread.create();
      const values = t.values(id);
      expect(values.form_date, "the Date is not the incident date she gave").toBe("2026-10-01");
      const dates = Object.entries(values).flatMap(([key, value]) => (value.match(DATE_SHAPES) ?? []).map((text) => ({ key, text, day: monthDay(text) })));
      expect(dates.filter((date) => date.day !== "10-01"), "a date she did not give is on the form").toEqual([]);
      expect(dates.map((date) => `${date.key}: ${date.text}`), "the incident date is written more than once").toEqual(["form_date: 2026-10-01"]);
    },
  },
  {
    id: "nov3-stepb-prior-coaching-kept",
    title: "a prior coaching \"signed May 2025\" added to the open Corrective Action reaches Prior Actions, or the reply says it did not",
    report:
      "the 2 Nov scan (s8): the manager gave the prior coaching and when it was signed; it was not on the form, and the reply said everything else was as it was",
    // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: STEP_B_FLAGS,
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("CA for Remy Calder for underperformance in the month of October");
      expect(thread.proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Remy Calder" });
      const id = await thread.create();
      const said = "Previous coaching was when she signed the policy manual, signed May 2025";
      t.patchWrites([patchOutput("this_form", [{ field: "prior_actions", value: "Coaching when she signed the policy manual — signed May 2025", evidence: said }])]);
      const reply = await turnOnDraft(t, thread, id, said);
      expect(reply.formProposal, "the turn about her open draft offered a new card").toBeUndefined();
      expect(t.values(id).prior_actions ?? "", "Prior Actions does not hold the coaching signed May 2025").toMatch(/may 2025/i);
      expect(reply.content, "the prior coaching was dropped and the reply says the form is as it was").not.toMatch(/\bas it was\b|nothing else (?:has )?changed/i);
    },
  },
];
