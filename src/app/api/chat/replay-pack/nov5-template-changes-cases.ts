import { expect, vi } from "vitest";

import REVISION_OLD from "@/test/fixtures/forms/corrective-action-revision-7.json";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE APPROVED CORRECTIVE ACTION CHANGES, AS THE CHAT MUST KEEP THEM
 * (PLAN.md, Step 0: tc-1 to tc-8)
 * ============================================================================
 *
 * The approved template changes (client request, 4 Nov 2026) are built in
 * other sessions: Corrective Action revision 8 here (#512; revision 7 in the
 * sibling app, #424) and the CA_SALES_POLICY_ENABLED track. These cases build,
 * copy and change none of it. They pin the agreed outcome on the chat path,
 * so a later step (the form record, one writer) that broke it fails here.
 *
 * Each reads the form's PINNED version, never "the newest". A case owned by a
 * flag of those tracks names it in `fixFlags` and is open until that track
 * turns it on; its behaviour is theirs to define. Every person is invented.
 */

type T = ReplayContext;

const SALON = "loc-0309";
const EMBER: DirectoryRow = {
  id: "e-ember-halloway",
  firstName: "Ember",
  lastName: "Thistlecombe",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: [SALON],
  positionName: "Tanning Consultant",
};
const NAME = "Ember Thistlecombe";
const REPORT = "The approved Corrective Action changes (client request relayed by QA, 4 Nov 2026), pinned for the chat path (PLAN.md, 5 Nov 2026)";

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-05T15:30:00Z"));
  t.directory([...STAFF, EMBER]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

/** The sentences of a field: split after ".", "!" or "?" followed by a space or the end. */
function sentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .filter((part) => part.trim() !== "");
}

async function caFor(t: T, said: string, checked: Record<string, string[]>, values: Record<string, string> = {}) {
  const thread = start(t);
  await thread.say(said);
  if (!thread.proposal) await thread.say("we already did coaching on 10/14");
  t.draftWrites({ observation: `Observed:\n${said}`, ...values }, checked);
  const id = await thread.create();
  return { thread, id };
}

export const NOV5_TEMPLATE_CHANGE_CASES: readonly ReplayCase[] = [
  {
    id: "tc-1-offense-boxes",
    title: "a new CA on the current version: a removed box (Absenteeism) is never saved; Attendance Policy is",
    report: `${REPORT}: Type of Offense is Attendance Policy / Standards of Conduct / Dress Code Violation / Other; Absenteeism removed.`,
    status: "fixed",
    async run(t) {
      const { id } = await caFor(t, `CA for ${NAME}, verbal, she was a no call no show on 11/3`, { offense_type: ["absenteeism"] });
      expect(t.checked(id).offense_type ?? [], "a box the current version removed was saved").not.toContain("absenteeism");
      const second = await caFor(t, `CA for ${NAME}, verbal, she was a no call no show on 11/3`, { offense_type: ["attendance_policy"] });
      expect(t.checked(second.id).offense_type ?? [], "Attendance Policy was not saved").toContain("attendance_policy");
    },
  },
  {
    id: "tc-2-conduct-sections",
    title: "a cell phone, social media or animals CA reads \"Standards of Conduct — <section>\", the section from the manual",
    report: `${REPORT}: Cell Phone, Social Media and Animals stay "Standards of Conduct — <section>".`,
    // Holds with production's flags (revision 8's section reading).
    status: "fixed",
    async run(t) {
      const { id } = await caFor(t, `CA for ${NAME}, verbal, she was on her cell phone on the salon floor during her shift on 11/3`, { offense_type: ["standards_of_conduct"] });
      expect(t.values(id).policy_violated ?? "", "Policy Violated does not read \"Standards of Conduct — Cell Phone\"").toMatch(/standards of conduct\s*[—–-]\s*cell phone/i);
    },
  },
  {
    id: "tc-3-cleaning-other",
    title: "a cleaning CA ticks Other, never Standards of Conduct by default",
    report: `${REPORT}: cleaning CAs go to "Other".`,
    // The cleaning→Other reading (`ca-conduct-reason.ts`) is not in this app yet: owned by the CA_SALES_POLICY track, no fix flag here until it is.
    status: { open: "the CA_SALES_POLICY track's cleaning→Other reading is not in this app yet; the model's Standards of Conduct tick stands" },
    async run(t) {
      const { id } = await caFor(t, `CA for ${NAME}, verbal, she did not sign off on the cleaning check list on 11/3`, { offense_type: ["standards_of_conduct"] });
      expect(t.checked(id).offense_type ?? [], "Other is not ticked").toContain("other");
      expect(t.checked(id).offense_type ?? [], "Standards of Conduct is ticked").not.toContain("standards_of_conduct");
    },
  },
  {
    id: "tc-4-old-draft-keeps-version",
    title: "a draft on the earlier CA version stays on it through chat edits; its boxes are its version's",
    report: `${REPORT}: old drafts stay on their version; only a revision on the newer one converts them (#512).`,
    status: "fixed",
    async run(t) {
      const { thread, id } = await caFor(t, `CA for ${NAME}, verbal, she was late on 11/3`, { offense_type: ["attendance_policy"] });
      t.pinVersion!(id, REVISION_OLD, 7);
      const pinned = t.forms().find((row) => row.id === id)!;
      const versionId = pinned.template_version_id;
      t.revisionWrites({ observation: `Observed:\n${NAME} was 20 minutes late on 11/3 and did not call ahead.` });
      await thread.say("add that she was 20 minutes late and did not call ahead");
      const after = t.forms().find((row) => row.id === id)!;
      expect(after.template_version_id, "a chat edit moved the draft onto another version").toBe(versionId);
      expect(after.template_version, "a chat edit moved the draft onto another version").toBe(7);
    },
  },
  {
    id: "tc-5-old-tick-not-converted-by-chat",
    title: "an earlier version's tick (Tardiness) is never converted by a chat edit; only \"Edit as new draft\" onto the newer version converts it",
    report: `${REPORT}: conversion only when a revision lands on the newer version (#512); saved forms and PDFs never rewritten.`,
    status: "fixed",
    async run(t) {
      const { thread, id } = await caFor(t, `CA for ${NAME}, verbal, she was late on 11/3`, {});
      // Filed on the earlier version with its own box, which revision 8 replaced.
      t.pinVersion!(id, REVISION_OLD, 7, { offense_type: ["tardiness"] });
      t.revisionWrites({ observation: `Observed:\n${NAME} was late on 11/3.` });
      await thread.say("add that she was late on 11/3");
      expect(t.checked(id).offense_type ?? [], "a chat edit converted or dropped the earlier version's tick").toEqual(["tardiness"]);
    },
  },
  {
    id: "tc-6-sales-msb-conduct",
    title: "a sales / MSB CA cites Standards of Conduct with the manual's heading and page",
    report: `${REPORT}: sales/MSB CAs cite Standards of Conduct from the retrieved manual section (CA_SALES_POLICY_ENABLED track).`,
    // Holds in this app with production's flags (revision 8: under performance is the Standards of Conduct box).
    status: "fixed",
    fixFlags: ["CA_SALES_POLICY_ENABLED", "CHAT_GLOSSARY_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say(`MSB CA for ${NAME} for underperformance in the month of October`);
      expect(thread.proposal, "no CA card").toMatchObject({ templateKey: "dpoa" });
      t.draftWrites({ observation: `Observed:\n${NAME} did not perform the Must See Behaviors in October.` }, { offense_type: ["standards_of_conduct"] });
      const id = await thread.create();
      const values = t.values(id);
      expect(values.policy_violated ?? "", "Policy Violated is not Standards of Conduct").toMatch(/standards of conduct/i);
      expect(values.policy_language ?? "", "Direct policy has no page").toMatch(/\bp(?:age|\.)\s*\d+/i);
    },
  },
  {
    id: "tc-7-action-plan-two-sentences",
    title: "the CA action plan is exactly two sentences, whatever the drafting model writes",
    report: `${REPORT}: action plans are exactly two sentences.`,
    // Holds in this app with production's flags: the drafted plan is not saved (ACTION_PLAN_MANAGER_ONLY_ENABLED), and a saved one is two sentences.
    status: "fixed",
    async run(t) {
      const { id } = await caFor(t, `CA for ${NAME}, verbal, no payroll deduct, she was late on 11/3`, { offense_type: ["attendance_policy"] }, {
        action_plan:
          "Management will review the Attendance policy with Ember Thistlecombe. Ember will arrive on time for every shift. Future policy violations may result in additional corrective action up to and including termination of employment.",
      });
      const plan = t.values(id).action_plan ?? "";
      // An empty plan is the manager's to write (ACTION_PLAN_MANAGER_ONLY_ENABLED where it is on); a saved one is two sentences.
      if (plan.trim()) expect(sentences(plan), "the action plan is not two sentences").toHaveLength(2);
    },
  },
  {
    id: "tc-8-payroll-amount",
    title: "payroll Yes asks the amount once, right after; the amount is only the manager's number",
    report: `${REPORT}: the payroll amount comes right after payroll Yes/No, asked once when Yes, filled only from the manager's number.`,
    status: "fixed",
    async run(t) {
      const thread = start(t);
      await thread.say(`CA for ${NAME}, verbal, she gave away a tan without ringing it up on 11/3`);
      if (!thread.proposal) await thread.say("we already did coaching on 10/14");
      const yes = await thread.say("payroll deduct yes");
      const asksAmount = (text: string) => /how much|what amount|amount (?:to|for|of)|\$\s*\?/i.test(text);
      const amount = await thread.say("$25");
      expect(asksAmount(amount.content), "the amount was asked again after it was given").toBe(false);
      void yes;
      // The drafting model writes another number; the manager's stands.
      t.draftWrites({ observation: `Observed:\n${NAME} gave away a tan without ringing it up on 11/3.`, payroll_deduct_amount: "40.00" }, { offense_type: ["standards_of_conduct"] });
      const id = await thread.create();
      expect(t.values(id).payroll_deduct_amount ?? "", "the amount is not the manager's number").not.toMatch(/40/);
    },
  },
];
