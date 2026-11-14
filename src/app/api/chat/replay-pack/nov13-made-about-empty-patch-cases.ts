import { expect, vi } from "vitest";

import { KEARNEY, replyMatchesDiff, savedForm, type ReplayCase, type ReplayContext } from "./cases";
import { REFUSAL_ROSTER, patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * A MADE-ABOUT REWRITE ANSWERS FROM THE SAVED FORM; AN ADD ALREADY ON IT SAYS SO (ported from the sibling app: QA's
 * live 17u test there, 13 Nov 2026; MADE_ABOUT_EMPTY_PATCH_ANSWERS_SAVED_ENABLED, ADD_ALREADY_ON_FORM_SAYS_SO_ENABLED)
 * ============================================================================
 *
 * The sibling app's tester's CA draft: "create a ca for <A>, she was late on 11/3/26", Create, "change the issue to not doing the
 * 10-minute sanitation" (saved), then "make it about her phone use instead, she was on her phone the whole shift". The
 * observation was rewritten and saved, and the reply said "I haven't changed the Corrective Action Form … everything on
 * it is as it was." The made-about path rewrote the account by the old path's revision, had nothing else to write (a
 * CA has no Other topic, no date was said) and handed the turn on: the route ran the revision a second time, which
 * found the new account already saved. Not EDIT_SEES_SAVED_FORM: the same with it off.
 *
 * Item 5, the same draft: "add that she was on the phone for the entire shift", which it already says, got the same
 * generic "I haven't changed …" in place of "already says that".
 *
 * The person is invented (the refusal roster's).
 */

const REPORT = "The sibling app's live 17u test, ported (13 Nov 2026): \"make it about her phone use instead, she was on her phone the whole shift\" saved a new observation and replied \"I haven't changed the Corrective Action Form … everything on it is as it was.\"";
const PHONE = "make it about her phone use instead, she was on her phone the whole shift";
const SANITATION = "change the issue to not doing the 10-minute sanitation";
const ADD = "add that she was on the phone for the entire shift";
const ADD_SHORT = "add that she was on the phone the whole shift";
const PHONE_ACCOUNT = "Observed:\nOttoline Ormsworth was on the phone for the entire shift.\n\nExpectation:\nPhone use is limited to breaks.";

async function toPhone(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-13T18:00:00Z"));
  t.directory(REFUSAL_ROSTER);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say("create a ca for Ottoline Ormsworth, she was late on 11/3/26");
  t.draftWrites({ observation: "Observed:\nOttoline Ormsworth arrived late for her shift on 11/3/26." }, { offense_type: ["attendance_policy"] });
  const id = await thread.create();
  // The tester's second edit saved: the patch reader replaces the account (its words only).
  t.patchReads!({ [SANITATION]: patch("this_form", [{ field: "observation", value: "Observed:\nOttoline Ormsworth did not do the 10-minute sanitation.", how: "replace", evidence: "not doing the 10-minute sanitation" }]) });
  await thread.say(SANITATION);
  t.revisionWrites({ observation: PHONE_ACCOUNT });
  const before = savedForm(t, id);
  const revisionsBefore = t.calls().revision;
  const reply = await thread.say(PHONE);
  const revisions = t.calls().revision - revisionsBefore;
  replyMatchesDiff(t, id, before, reply, PHONE);
  return { thread, id, before, reply, revisions };
}

export const NOV13_MADE_ABOUT_EMPTY_PATCH_CASES: ReplayCase[] = [
  {
    id: "nov13-made-about-empty-patch-answers-saved",
    title: `a CA draft, "${PHONE}": the observation is rewritten and saved, and the reply names the change (never "I haven't changed")`,
    report: REPORT,
    status: { open: "the saved observation changed, and the reply says \"I haven't changed the Corrective Action Form … everything on it is as it was.\"" },
    fixFlags: ["MADE_ABOUT_EMPTY_PATCH_ANSWERS_SAVED_ENABLED"],
    async run(t) {
      const { id, before, reply, revisions } = await toPhone(t);
      expect(t.values(id).observation ?? "", "the new account is saved").toMatch(/on the phone for the entire shift/i);
      expect(savedForm(t, id), "the form changed").not.toBe(before);
      expect(reply.content, `the reply never denies the saved change:\n${reply.content}`).not.toMatch(/haven't changed|everything on it is as it was/i);
      expect(reply.content, `the reply names the changed field:\n${reply.content}`).toMatch(/Observation/);
      expect(revisions, "one rewrite: the revision is never run a second time for the same turn").toBe(1);
    },
  },
  {
    id: "nov13-add-already-on-form-says-so",
    title: `item 5, the same draft: "${ADD}", which it already says: the reply says the form already says that (never "I haven't changed … everything on it is as it was")`,
    report: `${REPORT} (item 5)`,
    status: { open: "the reply is the generic \"I haven't changed the Corrective Action Form … everything on it is as it was.\"" },
    fixFlags: ["MADE_ABOUT_EMPTY_PATCH_ANSWERS_SAVED_ENABLED", "ADD_ALREADY_ON_FORM_SAYS_SO_ENABLED"],
    async run(t) {
      const { thread, id } = await toPhone(t);
      t.revisionWrites({ observation: PHONE_ACCOUNT });
      const before = savedForm(t, id);
      const reply = await thread.say(ADD);
      expect(savedForm(t, id), "nothing to change").toBe(before);
      expect(reply.content, `the reply says the form already says it:\n${reply.content}`).toMatch(/already says/i);
      expect(reply.content).not.toMatch(/everything on it is as it was/i);
    },
  },
  {
    id: "nov13-add-already-on-form-says-so-small-word-left-out",
    title: `the same draft, "${ADD_SHORT}" (the gate's wording: "the whole shift", no "for"): the reply says the form already says that`,
    report: `${REPORT} (item 5; Gate-Sunny-3's wording)`,
    status: { open: "the reply is the generic \"I haven't changed the Corrective Action Form … everything on it is as it was.\"" },
    fixFlags: ["MADE_ABOUT_EMPTY_PATCH_ANSWERS_SAVED_ENABLED", "ADD_ALREADY_ON_FORM_SAYS_SO_ENABLED"],
    async run(t) {
      const { thread, id } = await toPhone(t);
      t.revisionWrites({ observation: PHONE_ACCOUNT });
      const before = savedForm(t, id);
      const reply = await thread.say(ADD_SHORT);
      expect(savedForm(t, id), "nothing to change").toBe(before);
      expect(reply.content, `the reply says the form already says it:\n${reply.content}`).toMatch(/already says/i);
    },
  },
];
