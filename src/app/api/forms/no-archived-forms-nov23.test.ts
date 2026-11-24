import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { followUpCounts, followUpState, FOLLOW_UP_FILTERS, FOLLOW_UP_LABEL } from "@/lib/forms/follow-up";
import { countFormsOnFile } from "@/lib/forms/forms-on-file-counts";
import * as instances from "@/lib/forms/instances";

/**
 * Pau, 23 Nov 2026, on Form Monitoring (exact wording):
 *
 *   "the archived should not be acknowledged as a form, all just should be finalized or drafted."
 *
 * Decided with Pau: archiving is removed. A form is only Draft or Finalized (a replaced one stays `revised`, as the
 * database has it). There is no Archived shelf, badge, pill or Archive / Restore action; the API has no archive verb and
 * no `view` filter; the chat and the agent loop count every form under its own status.
 */

const read = (path: string) => readFileSync(path, "utf8");

describe("\"the archived should not be acknowledged as a form, all just should be finalized or drafted\"", () => {
  it("a form's follow-up state and pills never include archived", () => {
    expect(Object.keys(FOLLOW_UP_LABEL)).not.toContain("archived");
    expect(FOLLOW_UP_FILTERS).not.toContain("archived" as never);
    // Whatever an old row says in its (now unread) archived column, it is a normal draft or finalized form.
    const legacy = { status: "finalized" as const, followUpDate: "2026-08-01", followedUpAt: null, archivedAt: "2026-09-01T00:00:00Z" };
    expect(followUpState(legacy, "2026-09-04")).toBe("overdue");
    expect(followUpCounts([legacy], "2026-09-04").overdue).toBe(1);
  });

  it("counts put every form under draft or finalized, with no archived bucket", () => {
    const counts = countFormsOnFile([
      { employeeName: "Avery Avebury", templateName: "Corrective Action Form", formDate: "2026-11-19", status: "draft", archivedAt: "2026-11-19T23:00:00Z" } as never,
      { employeeName: "Avery Avebury", templateName: "Corrective Action Form", formDate: "2026-11-19", status: "finalized", archivedAt: "2026-11-19T23:00:00Z" } as never,
    ]);
    const statuses = counts.by_person.flatMap((person) => person.by_form.flatMap((form) => form.by_date.flatMap((day) => Object.keys(day.statuses))));
    expect(statuses.sort()).toEqual(["draft", "finalized"]);
  });

  it("the data layer has no archive action, view selector or archived filter", () => {
    expect((instances as Record<string, unknown>).archiveInstance).toBeUndefined();
    const source = read("src/lib/forms/instances.ts");
    expect(source).not.toMatch(/archived_at/);
    expect(source).not.toMatch(/InstanceView/);
  });

  it("the API has no archive verb and no ?view= filter", () => {
    const detail = read("src/app/api/forms/instances/[id]/route.ts");
    expect(detail).not.toMatch(/export async function PUT/);
    expect(detail).not.toMatch(/archiveInstance/);
    const list = read("src/app/api/forms/instances/route.ts");
    expect(list).not.toMatch(/searchParams\.get\("view"\)/);
  });

  it("Form Monitoring shows no Archived view, badge, Archive or Restore, and says finalized forms are kept on file", () => {
    const table = read("src/features/forms/monitoring-table.tsx");
    expect(table).not.toMatch(/Archived|Archive\b|Restore|archivedAt/);
    expect(table).toContain("Finalized forms are kept on file and cannot be deleted.");
    const page = read("src/app/(app)/forms/monitoring/page.tsx");
    expect(page).not.toMatch(/archived/i);
  });

  it("the chat and the agent loop no longer mark or leave out archived forms", () => {
    for (const file of [
      "src/lib/forms/chat-form-records.ts",
      "src/lib/forms/forms-on-file-counts.ts",
      "src/lib/ai/agent-loop/tools.ts",
      "src/lib/ai/agent-loop/run.ts",
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/archivedAt|include_archived|ARCHIVED_NOTE|\(archived\)"/);
    }
  });

  it("the migration clears the old flag and keeps the column", () => {
    const sql = read("supabase/migrations/20261124001000_forms_unarchive.sql");
    expect(sql).toMatch(/update public\.form_instances\s+set archived_at = null/);
    expect(sql).not.toMatch(/drop column/i);
  });
});
