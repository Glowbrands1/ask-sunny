import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * REMOVING A FORM — the rules that decide whether a record may be destroyed.
 *
 * Everything here guards the same boundary from a different side:
 *
 *   A DRAFT may be deleted outright, and its values and events go with it.
 *   A FINALIZED OR REVISED form may NOT, by any path but one — it is a signed HR
 *   document: it stays on file. The one path: an administrator's delete of a
 *   FINALIZED form (`allowFinalized`, 24 Nov 2026); a REVISED form never. There is no archiving (Pau, 23 Nov 2026: "the
 *   archived should not be acknowledged as a form, all just should be finalized
 *   or drafted").
 *   THE BULK SWEEP keys on `demo:` PROVENANCE and draft status, so an employee
 *   whose name happens to end "(test)" cannot be caught by it.
 *
 * The fake client is described in `src/test/fake-supabase.ts`. It models the
 * cascade's consequence; the cascade's DECLARATION is asserted against the
 * migration SQL further down, because a fake cannot prove a foreign key.
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
  deleteDemoInstances,
  deleteInstance,
  findDemoInstances,
  InstanceProtectedError,
  isDemoInstance,
  listInstances,
} = await import("./instances");

const VERSION_ID = "version-1";

/** One row, with the columns the overview exposes. */
function instance(overrides: Record<string, unknown>) {
  return {
    id: "form-1",
    template_id: "template-1",
    template_key: "policy_review",
    template_name: "Policy Review",
    template_short_name: "Policy Review",
    layout_family: "policy",
    template_version_id: VERSION_ID,
    template_version: 1,
    variant_key: null,
    employee_name: "Jordan Vance (test)",
    employee_role: null,
    location_id: null,
    location_name: "MO Kansas City Wornall",
    created_by: "demo:salon_director:MO Kansas City Wornall",
    created_by_role: "salon_director",
    source: "manual",
    status: "draft",
    form_date: "2026-09-01",
    follow_up_date: null,
    finalized_at: null,
    exported_at: null,
    archived_at: null,
    revises_instance_id: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  store.form_instances = [];
  store.form_instance_values = [];
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

describe("deleting a form", () => {
  it("removes a draft, and its values and events with it", async () => {
    store.form_instances = [instance({ id: "draft-1" })];
    store.form_instance_values = [
      { instance_id: "draft-1", field_key: "concern", value: "late", checked: [], filled_by: "manager", provenance: {} },
    ];
    store.form_instance_events = [{ instance_id: "draft-1", kind: "created", actor: "demo:x", detail: {} }];

    const deleted = await deleteInstance("draft-1");

    expect(deleted.id).toBe("draft-1");
    expect(store.form_instances).toHaveLength(0);
    // Nothing is left pointing at a form that no longer exists.
    expect(store.form_instance_values).toHaveLength(0);
    expect(store.form_instance_events).toHaveLength(0);
  });

  it("refuses a finalized form and leaves it exactly where it was", async () => {
    store.form_instances = [
      instance({ id: "final-1", status: "finalized", finalized_at: "2026-09-02T10:00:00Z" }),
    ];

    await expect(deleteInstance("final-1")).rejects.toThrow(InstanceProtectedError);
    expect(store.form_instances).toHaveLength(1);
    expect(store.form_instances[0].status).toBe("finalized");
  });

  it("refuses a revised form too — 'not draft' is the rule, not 'finalized'", async () => {
    store.form_instances = [instance({ id: "rev-1", status: "revised" })];

    await expect(deleteInstance("rev-1")).rejects.toThrow(InstanceProtectedError);
    expect(store.form_instances).toHaveLength(1);
  });

  it("says the form is kept on file, rather than just refusing", async () => {
    // On purpose (Pau, 23 Nov 2026): the message used to say "Archive it instead".
    store.form_instances = [instance({ id: "final-2", status: "finalized" })];

    await expect(deleteInstance("final-2")).rejects.toThrow(/kept on file/);
    await expect(deleteInstance("final-2")).rejects.not.toThrow(/[Aa]rchive/);
  });
});

/*
 * Pau, 24 Nov 2026: "why cant delete? in bubbles" — a finalized Corrective Action in Ask Bubbles' Forms Register had no Delete.
 * Decision: an administrator may delete a finalized form. The route passes `allowFinalized` for one; every other caller
 * (chat, agent loop, bulk delete, demo sweep) does not, so the tests above still hold for them.
 */
describe("deleting a finalized form as an administrator (allowFinalized)", () => {
  it("removes the finalized form, its values and its events", async () => {
    store.form_instances = [instance({ id: "final-1", status: "finalized", finalized_at: "2026-09-02T10:00:00Z" })];
    store.form_instance_values = [
      { instance_id: "final-1", field_key: "concern", value: "late", checked: [], filled_by: "manager", provenance: {} },
    ];
    store.form_instance_events = [{ instance_id: "final-1", kind: "finalized", actor: "admin", detail: {} }];

    const deleted = await deleteInstance("final-1", undefined, { allowFinalized: true });

    expect(deleted.id).toBe("final-1");
    expect(store.form_instances).toHaveLength(0);
    expect(store.form_instance_values).toHaveLength(0);
    expect(store.form_instance_events).toHaveLength(0);
  });

  it("still refuses a form that was replaced by a newer version: it is the older half of a chain", async () => {
    store.form_instances = [instance({ id: "rev-1", status: "revised" })];

    await expect(deleteInstance("rev-1", undefined, { allowFinalized: true })).rejects.toThrow(InstanceProtectedError);
    expect(store.form_instances).toHaveLength(1);
  });

  it("without the option it still refuses, and says an administrator can delete it", async () => {
    store.form_instances = [instance({ id: "final-3", status: "finalized", finalized_at: "2026-09-02T10:00:00Z" })];

    await expect(deleteInstance("final-3")).rejects.toThrow(/only an administrator can delete one/);
    expect(store.form_instances).toHaveLength(1);
  });

  it("puts the earlier version back to finalized when the revision that replaced it is deleted", async () => {
    store.form_instances = [
      instance({ id: "orig", status: "revised", finalized_at: "2026-09-02T10:00:00Z" }),
      instance({ id: "rev", status: "finalized", finalized_at: "2026-10-02T10:00:00Z", revises_instance_id: "orig" }),
    ];
    store.form_instance_events = [{ instance_id: "orig", kind: "revised", actor: "admin", detail: { revisionId: "rev" } }];

    await deleteInstance("rev", undefined, { allowFinalized: true });

    expect(store.form_instances.map((row) => [row.id, row.status])).toEqual([["orig", "finalized"]]);
  });

  it("leaves the earlier version alone when a different revision replaced it", async () => {
    store.form_instances = [
      instance({ id: "orig", status: "revised", finalized_at: "2026-09-02T10:00:00Z" }),
      instance({ id: "old-rev", status: "finalized", finalized_at: "2026-10-02T10:00:00Z", revises_instance_id: "orig" }),
    ];
    store.form_instance_events = [{ instance_id: "orig", kind: "revised", actor: "admin", detail: { revisionId: "someone-else" } }];

    await deleteInstance("old-rev", undefined, { allowFinalized: true });

    expect(store.form_instances.map((row) => [row.id, row.status])).toEqual([["orig", "revised"]]);
  });
});

describe("which rows count as demo data", () => {
  it("reads provenance, and never the employee's name", () => {
    expect(isDemoInstance({ createdBy: "demo:salon_director:QA" })).toBe(true);
    // A REAL person can be called this. The name is not evidence.
    expect(isDemoInstance({ createdBy: "auth0|4821" })).toBe(false);
  });

  it("splits demo drafts from demo forms that were finalized", async () => {
    store.form_instances = [
      instance({ id: "demo-draft" }),
      instance({ id: "demo-final", status: "finalized" }),
      // A real record whose employee name ends "(test)". It must not appear.
      instance({ id: "real-draft", created_by: "auth0|4821", employee_name: "Sam Okafor (test)" }),
    ];

    const sweep = await findDemoInstances();

    expect(sweep.deletable.map((row) => row.id)).toEqual(["demo-draft"]);
    expect(sweep.protected.map((row) => row.id)).toEqual(["demo-final"]);
  });
});

describe("the bulk demo sweep", () => {
  it("deletes demo drafts and nothing else", async () => {
    store.form_instances = [
      instance({ id: "demo-draft-1" }),
      instance({ id: "demo-draft-2" }),
      instance({ id: "demo-final", status: "finalized" }),
      instance({ id: "real-draft", created_by: "auth0|4821", employee_name: "Sam Okafor (test)" }),
    ];

    const result = await deleteDemoInstances(2);

    expect(result.deleted).toBe(2);
    expect(store.form_instances.map((row) => row.id)).toEqual(["demo-final", "real-draft"]);
  });

  it("aborts when the list changed underneath, and deletes nothing", async () => {
    store.form_instances = [instance({ id: "demo-draft-1" }), instance({ id: "demo-draft-2" })];

    // The screen offered to remove one; two are now eligible. Deleting "the
    // demo drafts" here would destroy a record nobody agreed to.
    await expect(deleteDemoInstances(1)).rejects.toThrow(InstanceProtectedError);
    expect(store.form_instances).toHaveLength(2);
  });

  it("does nothing, quietly, when there is nothing to sweep", async () => {
    store.form_instances = [instance({ id: "real-draft", created_by: "auth0|4821" })];

    expect(await deleteDemoInstances(0)).toEqual({ deleted: 0 });
    expect(store.form_instances).toHaveLength(1);
  });
});

describe("the monitoring list", () => {
  // On purpose (Pau, 23 Nov 2026): there were an Active / Archived / All shelf selector and an `archived_at` filter.
  // A form is only Draft or Finalized, so the list is every form, and a row the old flag marked is no different.
  it("lists every form, including a row the old archived flag had marked", async () => {
    store.form_instances = [
      instance({ id: "live-1" }),
      instance({ id: "once-hidden-1", archived_at: "2026-09-03T10:00:00Z" }),
    ];

    expect((await listInstances()).map((row) => row.id).sort()).toEqual(["live-1", "once-hidden-1"]);
  });
});

describe("the schema keeps the promise the code relies on", () => {
  const sql = readdirSync("supabase/migrations")
    .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
    .join("\n");

  it("cascades values and events from the form, rather than deleting them by hand", () => {
    /*
     * `deleteInstance` issues ONE delete. Orphaned values are prevented by the
     * foreign keys, not by ordering three statements correctly — so the
     * declaration is the thing worth asserting.
     */
    for (const table of ["form_instance_values", "form_instance_events"]) {
      const definition = sql.slice(sql.indexOf(`create table public.${table}`));
      expect(definition.slice(0, 400), table).toMatch(
        /instance_id uuid not null references public\.form_instances \(id\) on delete cascade/,
      );
    }
  });

  it("does not dangle a revision whose original was deleted", () => {
    expect(sql).toMatch(/revises_instance_id[\s\S]{0,120}on delete set null/);
  });

  it("keeps archiving out of the status enum", () => {
    // If 'archived' were a status, a finalized form could stop being finalized.
    const statusEnum = sql.slice(
      sql.indexOf("create type public.form_instance_status"),
    );
    expect(statusEnum.slice(0, 200)).not.toMatch(/'archived'/);
  });
});
