import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

import type { FormsActor } from "./access";

/*
 * QA, 24 Nov 2026 (Ask Sunny, live): "The overdue counts disagree. The Overview, the sidebar and the Form Monitoring
 * banner say 19 overdue. Form Monitoring's Overdue filter says 8 and Open says 6." One queue now feeds all of them:
 * every outstanding follow-up the reader may open, read with no cap, with the Overview's exclusions.
 */

const store: FakeStore = { form_instances: [], form_instance_values: [], form_instance_events: [], form_template_versions: [] };
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

const { followUpQueueOf, readFollowUpQueue } = await import("./follow-up-queue");
const { listOutstandingFollowUps } = await import("./instances");

const TODAY = "2026-11-24";
const KEARNEY = "loc-0309";
const PREVIEW: FormsActor = { id: "preview", role: null, verified: false, scope: null, visibility: null, hrApprover: false };

function instance(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    template_id: "template-1",
    template_key: "coaching",
    template_name: "Coaching Form",
    template_short_name: "Coaching",
    layout_family: "coaching",
    template_version_id: "v1",
    template_version: 1,
    variant_key: null,
    employee_name: `Invented Person ${id}`,
    employee_role: null,
    location_id: KEARNEY,
    location_name: "NE Kearney",
    created_by: "someone",
    created_by_role: "salon_director",
    source: "manual",
    status: "finalized",
    form_date: "2026-10-01",
    follow_up_date: "2026-11-01",
    followed_up_at: null,
    followed_up_by: null,
    finalized_at: "2026-10-01T12:00:00Z",
    exported_at: null,
    archived_at: null,
    revises_instance_id: null,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  store.form_instances = [];
});

describe("QA 24 Nov: one overdue count, over every outstanding follow-up", () => {
  it("counts every overdue follow-up, past the 50 the old read stopped at and past one page of 1,000", async () => {
    store.form_instances = [
      ...Array.from({ length: 1_190 }, (_, i) => instance(`late-${i}`)),
      ...Array.from({ length: 30 }, (_, i) => instance(`open-${i}`, { follow_up_date: "2026-12-15" })),
    ];
    // The old read: the first 50, so the badge said at most 50.
    expect(await listOutstandingFollowUps(50, null)).toHaveLength(50);
    const queue = await readFollowUpQueue(
      { actor: PREVIEW, locationIds: null, ownCreatedBy: null, noSalon: false },
      { readsExit: true, today: TODAY },
    );
    expect(queue.attention.overdue).toBe(1_190);
    expect(queue.open).toBe(30);
    expect(queue.forms).toHaveLength(1_220);
  });

  it("applies the Overview's exclusions everywhere: test records, unreadable Exit forms, followed-up and untracked forms", () => {
    const rows = [
      instance("counted"),
      instance("open", { follow_up_date: "2026-11-26" }),
      instance("test-salon", { location_id: null, location_name: "Maple Crossing" }),
      instance("exit", { layout_family: "exit" }),
    ].map((row) => ({
      id: row.id,
      layoutFamily: row.layout_family,
      employeeName: row.employee_name,
      locationName: row.location_name,
      locationId: row.location_id,
      status: "finalized" as const,
      followUpDate: row.follow_up_date,
      followedUpAt: null,
      revisesInstanceId: null,
      createdBy: "someone",
    }));
    const queue = followUpQueueOf(rows as never, { actor: PREVIEW, readsExit: false, today: TODAY, excludedNames: new Set() });
    expect(queue.forms.map((form) => form.id)).toEqual(["counted", "open"]);
    expect(queue.attention).toEqual({ overdue: 1, dueThisWeek: 1, needsAttention: 2 });
    expect(queue.open).toBe(1);
    expect(queue.excluded).toBe(1);
  });

  it("a reader with no salon reads nothing", async () => {
    store.form_instances = [instance("late")];
    const queue = await readFollowUpQueue({ actor: PREVIEW, locationIds: [], ownCreatedBy: null, noSalon: true }, { readsExit: true, today: TODAY });
    expect(queue.attention.overdue).toBe(0);
  });

  it("the rail, the Overview and Form Monitoring all count this queue, and nothing else", () => {
    for (const file of ["src/app/(app)/layout.tsx", "src/app/(app)/page.tsx", "src/app/(app)/forms/monitoring/page.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(/readFollowUpQueue\(access, \{ readsExit, today \}\)/);
      expect(source, file).not.toMatch(/await listOutstandingFollowUps\(|attentionSummary\(/);
    }
  });
});
