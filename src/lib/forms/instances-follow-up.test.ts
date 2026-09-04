import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * FOLLOW-UP WRITES, AND THE ONE THING THEY MUST NEVER DO.
 *
 * Scheduling, moving and completing a follow-up are operational acts on a
 * record that may already be signed. So the assertions come in pairs: the
 * follow-up column changed, AND the document did not — same status, same
 * `finalized_at`, same values, byte for byte.
 */

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => fakeSupabase(store),
}));

const {
  FollowUpError,
  archiveInstance,
  listOutstandingFollowUps,
  markFollowedUp,
  reopenFollowUp,
  setFollowUpDate,
} = await import("./instances");

const VERSION_ID = "version-1";
const ACTOR = "demo:salon_director:QA";

function instance(overrides: Record<string, unknown>) {
  return {
    id: "form-1",
    template_id: "template-1",
    template_key: "coaching",
    template_name: "Coaching Form",
    template_short_name: "Coaching",
    layout_family: "coaching",
    template_version_id: VERSION_ID,
    template_version: 1,
    variant_key: null,
    employee_name: "Jordan Vance (test)",
    employee_role: null,
    location_id: null,
    location_name: "Riverbend Commons",
    created_by: ACTOR,
    created_by_role: "salon_director",
    source: "manual",
    status: "finalized",
    form_date: "2026-09-01",
    follow_up_date: null,
    followed_up_at: null,
    followed_up_by: null,
    finalized_at: "2026-09-01T12:00:00Z",
    exported_at: null,
    archived_at: null,
    revises_instance_id: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

const row = (id = "form-1") => store.form_instances.find((entry) => entry.id === id)!;
const kinds = (id = "form-1") =>
  store.form_instance_events.filter((e) => e.instance_id === id).map((e) => e.kind);

beforeEach(() => {
  store.form_instances = [instance({})];
  store.form_instance_values = [
    {
      instance_id: "form-1",
      field_key: "concern",
      value: "Arrived late three times",
      checked: [],
      filled_by: "manager",
      provenance: {},
    },
  ];
  store.form_instance_events = [];
  store.form_template_versions = [
    {
      id: VERSION_ID,
      template_id: "template-1",
      version: 1,
      status: "published",
      document: { blocks: [] },
      variants: [],
      notes: "",
      created_by: "system",
      created_at: "2026-09-01T00:00:00Z",
      published_at: "2026-09-01T00:00:00Z",
      published_by: "system",
    },
  ];
});

describe("starting to track a follow-up", () => {
  it("persists the date and records that tracking started", async () => {
    const updated = await setFollowUpDate("form-1", "2026-09-10", ACTOR);

    expect(updated.followUpDate).toBe("2026-09-10");
    expect(row().follow_up_date).toBe("2026-09-10");
    expect(kinds()).toEqual(["follow_up_started"]);
  });

  it("leaves the finalized document completely alone", async () => {
    const valuesBefore = JSON.stringify(store.form_instance_values);
    await setFollowUpDate("form-1", "2026-09-10", ACTOR);

    /*
     * THE LOAD-BEARING ASSERTION of this whole feature. Follow-up tracking is
     * metadata around a signed HR document; if it could reach the document,
     * `forms_guard_finalized_values()` would be the only thing standing between
     * a date change and an edited disciplinary record.
     */
    expect(row().status).toBe("finalized");
    expect(row().finalized_at).toBe("2026-09-01T12:00:00Z");
    expect(JSON.stringify(store.form_instance_values)).toBe(valuesBefore);
  });

  it("refuses a date that is not a date", async () => {
    for (const bad of ["tomorrow", "09/10/2026", "2026-13-01", "2026-02-30", ""]) {
      await expect(setFollowUpDate("form-1", bad, ACTOR), bad).rejects.toThrow(FollowUpError);
    }
    expect(row().follow_up_date).toBeNull();
  });

  it("refuses to schedule a follow-up on an archived form", async () => {
    store.form_instances = [instance({ archived_at: "2026-09-02T00:00:00Z" })];
    await expect(setFollowUpDate("form-1", "2026-09-10", ACTOR)).rejects.toThrow(/archived/i);
  });
});

describe("moving the date", () => {
  beforeEach(() => {
    store.form_instances = [instance({ follow_up_date: "2026-09-10" })];
  });

  it("records the move as a different kind of event, with both dates", async () => {
    await setFollowUpDate("form-1", "2026-09-03", ACTOR);

    expect(row().follow_up_date).toBe("2026-09-03");
    expect(kinds()).toEqual(["follow_up_date_changed"]);
    const event = store.form_instance_events.at(-1)!;
    // "What was it before" has to be answerable later.
    expect(event.detail).toEqual({ from: "2026-09-10", to: "2026-09-03" });
    expect(event.actor).toBe(ACTOR);
  });

  it("writes nothing when the date has not actually changed", async () => {
    await setFollowUpDate("form-1", "2026-09-10", ACTOR);
    expect(kinds()).toEqual([]);
  });

  it("refuses to move a date on a completed follow-up", async () => {
    store.form_instances = [
      instance({ follow_up_date: "2026-09-10", followed_up_at: "2026-09-10T15:00:00Z", followed_up_by: ACTOR }),
    ];
    await expect(setFollowUpDate("form-1", "2026-09-20", ACTOR)).rejects.toThrow(/reopen/i);
  });
});

describe("marking a follow-up done", () => {
  beforeEach(() => {
    store.form_instances = [instance({ follow_up_date: "2026-09-01" })];
  });

  it("records when, and who says so", async () => {
    const updated = await markFollowedUp("form-1", ACTOR);

    expect(updated.followedUpAt).toBeTruthy();
    expect(updated.followedUpBy).toBe(ACTOR);
    expect(row().followed_up_by).toBe(ACTOR);
  });

  it("KEEPS the date it was scheduled for", async () => {
    await markFollowedUp("form-1", ACTOR);

    // Clearing it would destroy the only evidence of how late the follow-up
    // was — the question somebody reviewing a coaching pattern actually asks.
    expect(row().follow_up_date).toBe("2026-09-01");
    const event = store.form_instance_events.at(-1)!;
    expect(kinds()).toEqual(["followed_up"]);
    expect(event.detail).toMatchObject({ scheduledFor: "2026-09-01" });
  });

  it("still does not touch the document", async () => {
    const valuesBefore = JSON.stringify(store.form_instance_values);
    await markFollowedUp("form-1", ACTOR);
    expect(row().status).toBe("finalized");
    expect(JSON.stringify(store.form_instance_values)).toBe(valuesBefore);
  });

  it("refuses on a form nobody scheduled", async () => {
    store.form_instances = [instance({})];
    await expect(markFollowedUp("form-1", ACTOR)).rejects.toThrow(/[Ss]tart tracking/);
  });

  it("is idempotent — marking it twice writes one event", async () => {
    await markFollowedUp("form-1", ACTOR);
    await markFollowedUp("form-1", "demo:owner:Someone else");
    expect(kinds()).toEqual(["followed_up"]);
    expect(row().followed_up_by).toBe(ACTOR);
  });
});

describe("reopening a follow-up", () => {
  it("clears the completion but keeps it in the history", async () => {
    store.form_instances = [instance({ follow_up_date: "2026-09-01" })];
    await markFollowedUp("form-1", ACTOR);
    await reopenFollowUp("form-1", "demo:owner:QA");

    expect(row().followed_up_at).toBeNull();
    expect(row().followed_up_by).toBeNull();
    // Both facts survive: it was completed, and then it was reopened.
    expect(kinds()).toEqual(["followed_up", "follow_up_reopened"]);
    expect(store.form_instance_events.at(-1)!.detail).toMatchObject({ wasCompletedBy: ACTOR });
  });
});

describe("the outstanding query the Overview reads", () => {
  beforeEach(() => {
    store.form_instances = [
      instance({ id: "overdue-1", follow_up_date: "2026-09-01" }),
      instance({ id: "open-1", follow_up_date: "2026-09-30" }),
      instance({
        id: "done-1",
        follow_up_date: "2026-08-01",
        followed_up_at: "2026-08-02T10:00:00Z",
        followed_up_by: ACTOR,
      }),
      instance({ id: "hidden-1", follow_up_date: "2026-08-01", archived_at: "2026-08-05T10:00:00Z" }),
      instance({ id: "untracked-1" }),
    ];
  });

  it("returns only what is outstanding, soonest first", async () => {
    const outstanding = await listOutstandingFollowUps();
    expect(outstanding.map((entry) => entry.id)).toEqual(["overdue-1", "open-1"]);
  });

  it("drops a form the moment it is archived — §23", async () => {
    await archiveInstance("open-1", ACTOR, true);
    const outstanding = await listOutstandingFollowUps();
    expect(outstanding.map((entry) => entry.id)).toEqual(["overdue-1"]);
  });

  it("drops a form the moment it is followed up", async () => {
    await markFollowedUp("overdue-1", ACTOR);
    const outstanding = await listOutstandingFollowUps();
    expect(outstanding.map((entry) => entry.id)).toEqual(["open-1"]);
  });
});

describe("the schema backs what the code assumes", () => {
  const sql = readdirSync("supabase/migrations")
    .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
    .join("\n");

  it("lists every event kind the follow-up code writes", () => {
    /*
     * The kind column is an enum, so a kind the type does not list fails at the
     * insert — in production, with the whole call going down with it. That
     * happened once with 'archived'; these are asserted rather than trusted.
     */
    for (const kind of [
      "follow_up_started",
      "follow_up_date_changed",
      "followed_up",
      "follow_up_reopened",
    ]) {
      expect(sql, kind).toMatch(new RegExp(`add value if not exists '${kind}'`));
    }
  });

  it("will not let a completion be anonymous or unscheduled", () => {
    expect(sql).toMatch(/check \(\(followed_up_at is null\) = \(followed_up_by is null\)\)/);
    expect(sql).toMatch(/check \(followed_up_at is null or follow_up_date is not null\)/);
  });

  it("keeps follow-up out of the form's own status enum", () => {
    const statusEnum = sql.slice(sql.indexOf("create type public.form_instance_status"));
    expect(statusEnum.slice(0, 220)).not.toMatch(/'open'|'overdue'|'followed_up'/);
  });

  it("still freezes a finalized form's values", () => {
    // Untouched by this checkpoint, and asserted here because follow-up writes
    // are the new thing in the same neighbourhood.
    expect(sql).toMatch(/forms_guard_finalized_values/);
    expect(sql).toMatch(/create trigger form_instance_values_frozen/);
  });
});
