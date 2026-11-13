import { expect, vi } from "vitest";

import { accountChangeRederivesPolicyEnabled } from "@/lib/config/chat-quality-flags";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * A SMALL EDIT TO THE SAME ACCOUNT KEEPS ITS POLICY (ACCOUNT_CHANGE_CLOSE_KEPT_ENABLED)
 * ============================================================================
 *
 * Gate-Sunny-2 on #946 (13 Nov 2026, via QA): ACCOUNT_CHANGE_REDERIVES_POLICY also re-derives on small edits to the same
 * account (an inserted word, a date correction, a typo fix, a reworded same account), so an app-filled policy from a
 * section the manager named in the request could move. Reproduced here: on a Corrective Action the manager asked for
 * "for violating the care and cleaning policy", fixing "santiation" or rewording "did not do" as "skipped" moved the
 * named Care and Cleaning to Other. With ACCOUNT_CHANGE_CLOSE_KEPT on, such an edit keeps the policy; a new account
 * (the phone) still re-derives it.
 *
 * The gate's named-Late-Opening shapes are here too. They hold either way in this replay: the plain lateness account
 * reads no manual section (so nothing would move), and a date correction goes through the form-date path, not this
 * step. They stay as guards. The person is invented (on no directory).
 */

const TESS: DirectoryRow = { id: "e-tess-varga-ack", firstName: "Tess", lastName: "Varga", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const CARE = {
  chunkIndex: 21.5,
  chunkId: "jba-21-5",
  locator: "Page 21 — Care and Cleaning of Equipment and Facilities",
  page: 22,
  content: "Care and Cleaning of Equipment and Facilities\nEmployees keep the salon, its beds and its equipment clean and sanitized as directed.",
  section: "Care and Cleaning of Equipment and Facilities",
  printedPage: 21,
  sections: [],
};
const FLAGS = ["ACCOUNT_CHANGE_REDERIVES_POLICY_ENABLED", "ACCOUNT_CHANGE_CLOSE_KEPT_ENABLED"];
const REPORT = "Gate-Sunny-2 on #946 (13 Nov 2026, via QA): a small edit to the same account re-derived a policy the manager named";
const CARE_REQUEST = "create ca for tess varga for violating the care and cleaning policy, she did not do the 10 minute sanitation. verbal.";
const LATE_REQUEST = "create ca for tess varga for violating the late opening policy, she was late for her shift. verbal.";

interface Shape {
  readonly key: string;
  readonly request: string;
  readonly first: string;
  readonly edit: string;
  readonly next: string;
  readonly keeps: RegExp;
}

const SHAPES: readonly Shape[] = [
  { key: "care-typo", request: CARE_REQUEST, first: "Observed:\nShe did not do the 10 minute santiation.", edit: "change the issue to she did not do the 10 minute sanitation", next: "Observed:\nTess did not do the 10 minute sanitation.", keeps: /care and cleaning/i },
  { key: "care-reworded", request: CARE_REQUEST, first: "Observed:\nShe did not do the 10 minute sanitation.", edit: "change the issue to she skipped the 10 minute sanitation", next: "Observed:\nTess skipped the 10 minute sanitation.", keeps: /care and cleaning/i },
  { key: "care-word-added", request: CARE_REQUEST, first: "Observed:\nShe did not do the 10 minute sanitation.", edit: "change the issue to she did not do the 10 minute sanitation this morning", next: "Observed:\nTess did not do the 10 minute sanitation this morning.", keeps: /care and cleaning/i },
  { key: "late-opening-typo", request: LATE_REQUEST, first: "Observed:\nShe was lte for her shift.", edit: "change the issue to she was late for her shift", next: "Observed:\nTess was late for the shift.", keeps: /late opening/i },
  { key: "late-opening-date", request: LATE_REQUEST, first: "Observed:\nShe was late for her shift on the 3rd.", edit: "change the issue to she was late for her shift on the 4th", next: "Observed:\nTess was late for the shift on the 4th.", keeps: /late opening/i },
];

async function draft(t: ReplayContext, request: string, first: string) {
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  t.directory([...STAFF, TESS]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([CARE]);
  const thread = t.thread();
  await thread.say(request);
  t.draftWrites({ observation: first });
  const id = await thread.create();
  return { thread, id };
}

export const NOV13_ACCOUNT_CHANGE_CLOSE_KEPT_CASES: ReplayCase[] = [
  ...SHAPES.map(
    (shape): ReplayCase => ({
      id: `nov13-account-change-close-kept-${shape.key}`,
      title: `"${shape.request}" then "${shape.edit}": the same account after a small edit keeps the policy the manager named`,
      report: REPORT,
      status: "fixed",
      fixFlags: FLAGS,
      async run(t) {
        const { thread, id } = await draft(t, shape.request, shape.first);
        const named = t.values(id).policy_violated ?? "";
        expect(named, "the draft does not carry the named policy").toMatch(shape.keeps);
        t.patchReads!({ [shape.edit]: patch("this_form", [{ field: "observation", value: shape.next, how: "replace", evidence: shape.edit.replace(/^change the issue to /, "") }]) });
        await thread.say(shape.edit);
        expect(t.values(id).policy_violated ?? "", `the named policy moved after "${shape.edit}"`).toBe(named);
        expect(t.checked(id).offense_type ?? [], "the offense moved to Other").not.toContain("other");
      },
    }),
  ),
  {
    id: "nov13-account-change-close-kept-new-account-still-moves",
    title: `"${CARE_REQUEST}" then "change the issue to she was on her phone the whole shift": a new account still re-derives the policy`,
    report: `${REPORT}; negative`,
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      const { thread, id } = await draft(t, CARE_REQUEST, "Observed:\nShe did not do the 10 minute sanitation.");
      const PHONE = "change the issue to she was on her phone the whole shift";
      t.patchReads!({ [PHONE]: patch("this_form", [{ field: "observation", value: "Observed:\nShe was on her phone the whole shift.", how: "replace", evidence: "she was on her phone the whole shift" }]) });
      await thread.say(PHONE);
      // Production (both flags off) keeps whatever was there; the fix arm re-derives the phone policy.
      if (accountChangeRederivesPolicyEnabled()) {
        expect(t.values(id).policy_violated ?? "", `a new account did not re-derive the policy: ${JSON.stringify({ o: t.values(id).observation, off: t.checked(id).offense_type, pl: (t.values(id).policy_language ?? "").slice(0, 60), ap: (t.values(id).action_plan ?? "").slice(0, 70) })}`).toMatch(/cell phone/i);
      }
    },
  },
];
