import { expect, vi } from "vitest";

import { deleteInstance } from "@/lib/forms/instances";

import { KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * WHO DELETED A FORM (board f066, QA; Pau approved 20 Nov 2026: "for sure")
 * ============================================================================
 *
 * Four Test Testy drafts were deleted between 17 and 20 Nov 2026 and nothing said who or when. Every delete now leaves
 * an append-only record (`form_instance_deletions`), and an administrator can ask the assistant about it:
 * read_form_deletions, administrators only. "Test Testy" and the deleting District Manager's account are invented.
 */
const REPORT = "QA, board f066 (20 Nov 2026): four Test Testy drafts deleted with no record of who or when";
const FLAG = "AGENT_LOOP_ENABLED";
const GLOBAL = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const ASKED = "who deleted Test Testy's form";

const TESTY: DirectoryRow = { id: "e-test-testy", firstName: "Test", lastName: "Testy", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** A Test Testy Corrective Action draft, created from a card, then deleted by a District Manager in Form Monitoring. */
async function deletedDraft(t: ReplayContext): Promise<void> {
  vi.setSystemTime(new Date("2026-11-20T18:00:00Z"));
  t.directory([TESTY]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  t.loopModel!(loopStandIn((view) =>
    lastResult(view, "propose_form")
      ? { text: "Here's the Corrective Action Form for **Test Testy**." }
      : { tool: "propose_form", input: { template_key: "dpoa", employee_id: TESTY.id, policy: "Attendance", what_happened: "Test Testy was late to her shift." } },
  ));
  await thread.say("write up Test Testy for being late to her shift");
  const id = await thread.create();
  // The DELETE route's own call (`/api/forms/instances/[id]`), with the actor it authorized.
  await deleteInstance(id, { id: "dm-quill-harrow", role: "district_manager", via: "route" });
}

function asks(t: ReplayContext, role: string, scope: unknown) {
  t.as(role, scope);
  const model = loopStandIn((view: LoopView): LoopDecision =>
    lastResult(view, "read_form_deletions") ? { text: "Here is what the deletion record shows." } : { tool: "read_form_deletions", input: { employee_name: "Test Testy" } },
  );
  t.loopModel!(model);
  return () => (model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_form_deletions")).at(-1)?.output ?? {}) as Record<string, unknown>;
}

export const NOV20_AGENT_LOOP_FORM_DELETION_RECORD_CASES: ReplayCase[] = [
  {
    id: "nov20-agent-loop-admin-asks-who-deleted-the-form",
    title: `an admin: "${ASKED}": read_form_deletions gives the District Manager who deleted the draft, when, and that it was Form Monitoring`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await deletedDraft(t);
      expect(t.rows?.("form_instance_deletions") ?? [], "the delete left no record").toHaveLength(1);
      const result = asks(t, "admin", GLOBAL);
      await t.thread().say(ASKED);
      const output = result();
      expect(output.refused, "an admin was refused").toBeUndefined();
      expect(output.deletions, "the record did not reach the model").toEqual([
        expect.objectContaining({ form: "Corrective Action Form", employee: "Test Testy", status_when_deleted: "draft", deleted_by_role: "district_manager", how: "Form Monitoring" }),
      ]);
      expect(String((output.deletions as Record<string, unknown>[])[0]!.deleted_by)).toMatch(/dm-quill-harrow/);
      expect(String((output.deletions as Record<string, unknown>[])[0]!.deleted_at)).toMatch(/Nov 20, 2026/);
    },
  },
  {
    id: "nov20-agent-loop-manager-asks-who-deleted-refused",
    title: `a salon director: "${ASKED}": read_form_deletions refuses (administrators only), and nothing from the record reaches the model`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await deletedDraft(t);
      const result = asks(t, "salon_director", KEARNEY);
      await t.thread().say(ASKED);
      const output = result();
      expect(output.refused).toMatch(/administrators only/);
      expect(JSON.stringify(output), "the record reached a manager").not.toMatch(/dm-quill-harrow|Form Monitoring/);
    },
  },
];
