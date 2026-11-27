import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope } from "@/types";

/**
 * WHO OWNS A FORM'S FOLLOW-UP (the owner, 27 Nov 2026, approved "ok to all"): the creator can hand a form's follow-up to
 * someone else (e.g. the DM). Choices are only people who may open that form at its salon and edit it; nobody named
 * means the creator, as before; the owner and the creator both get the bells. Invented people only.
 */

const store: FakeStore = { form_instances: [], form_instance_values: [], form_instance_events: [], form_template_versions: [] };
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

const { assignFollowUpOwner, followUpOwnerChoices, FollowUpOwnerError, mayOwnFollowUp } = await import("./follow-up-owner");
const { followUpOwnerOf, followUpRecipients, namedFollowUpOwner } = await import("./follow-up-owner-rules");
const { runFollowUpNotices } = await import("./follow-up-notices");
type Deps = import("./follow-up-owner").FollowUpOwnerDeps;
type Row = import("./instances").InstanceRow;

const salon = (id: string, ...also: string[]): AccessScope => ({ level: "salon", primaryAreaId: id, alsoCoversAreaIds: also });
const CREATOR = "acct-creator";

function form(overrides: Partial<Row> = {}): Row {
  return {
    id: "form-1",
    templateKey: "coaching",
    templateName: "Coaching Form",
    templateShortName: "Coaching",
    layoutFamily: "coaching",
    employeeName: "Addy Quillfeather",
    locationId: "loc-0309",
    locationName: "NE Kearney",
    createdBy: CREATOR,
    status: "finalized",
    followUpDate: "2026-12-03",
    followedUpAt: null,
    hrApprovalState: null,
    hrApprovalSenders: [],
    ...overrides,
  } as Row;
}

/** The directory: a DM over the form's salon, a DM elsewhere, a Salon Director of the salon, an Assistant, an admin. */
const ACCOUNTS = [
  { id: "acct-dm", name: "Tobin Marsh", role: "district_manager" as const, scope: salon("loc-0307", "loc-0309") },
  { id: "acct-dm-away", name: "Tobias Wren", role: "district_manager" as const, scope: salon("loc-0101") },
  { id: CREATOR, name: "Quinby Hale", role: "salon_director" as const, scope: salon("loc-0309") },
  { id: "acct-employee", name: "Lark Penrose", role: "employee" as const, scope: salon("loc-0309") },
  { id: "acct-admin", name: "Odile Ferris", role: "admin" as const, scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] } as AccessScope },
];

const deps: Deps = {
  listAccounts: async () => ACCOUNTS,
  // As resolveFormsVisibility: admins read all salons; everyone else their own.
  visibilityOf: async (account) => (account.role === "admin" ? { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] } : account.scope),
  hrApproverOf: async () => false,
  editPermissionOf: async () => "create_coaching",
};

beforeEach(() => {
  store.form_instances = [
    {
      id: "form-1", template_id: "t-1", template_key: "coaching", template_name: "Coaching Form", template_short_name: "Coaching", layout_family: "coaching",
      template_version_id: "v-1", template_version: 1, employee_name: "Addy Quillfeather", location_id: "loc-0309", location_name: "NE Kearney",
      created_by: CREATOR, source: "manual", status: "finalized", form_date: "2026-11-27", follow_up_date: "2026-12-03", followed_up_at: null,
      created_at: "2026-11-27T10:00:00Z", updated_at: "2026-11-27T10:00:00Z",
    },
  ];
  store.form_instance_events = [];
});

describe("the owner rule", () => {
  it("nobody named: the creator owns it, as before", () => {
    expect(followUpOwnerOf(form())).toBe(CREATOR);
    expect(followUpRecipients(form())).toEqual([CREATOR]);
    expect(namedFollowUpOwner(CREATOR, form())).toBe(false);
  });

  it("named: the owner first, and the creator still gets the bells", () => {
    const handed = form({ followUpOwner: "acct-dm" });
    expect(followUpOwnerOf(handed)).toBe("acct-dm");
    expect(followUpRecipients(handed)).toEqual(["acct-dm", CREATOR]);
    expect(namedFollowUpOwner("acct-dm", handed)).toBe(true);
    expect(namedFollowUpOwner("acct-dm-away", handed)).toBe(false);
  });
});

describe("who may be offered as the owner", () => {
  it("only people with access to the form's salon who may edit it", async () => {
    const names = (await followUpOwnerChoices(form(), deps)).map((choice) => choice.name);
    expect(names).toEqual(["Odile Ferris", "Quinby Hale", "Tobin Marsh"]);
    // A DM of another district and a role without Form Monitoring are never offered.
    expect(names).not.toContain("Tobias Wren");
    expect(names).not.toContain("Lark Penrose");
  });

  it("a form with no salon is offered only to readers of every salon (and its creator, whose form it is)", async () => {
    const names = (await followUpOwnerChoices(form({ locationId: null }), deps)).map((choice) => choice.name);
    expect(names).toEqual(["Odile Ferris", "Quinby Hale"]);
  });

  it("the Exit form only to roles that may create one", () => {
    const exit = form({ layoutFamily: "exit" });
    const actor = { id: "x", role: "district_manager" as const, verified: true, scope: salon("loc-0309"), visibility: salon("loc-0309") };
    expect(mayOwnFollowUp(actor, exit, "create_exit_form", (_role, permission) => permission !== "create_exit_form")).toBe(false);
    expect(mayOwnFollowUp(actor, exit, "create_exit_form")).toBe(true);
  });
});

describe("assigning", () => {
  it("names someone the page offers, and records who handed it to whom", async () => {
    const { instance, owner } = await assignFollowUpOwner(form(), "acct-dm", CREATOR, deps);
    expect(owner?.name).toBe("Tobin Marsh");
    expect(instance.followUpOwner).toBe("acct-dm");
    expect(store.form_instance_events.map((event) => [event.kind, event.detail])).toEqual([["follow_up_owner_changed", { from: null, to: "acct-dm" }]]);
  });

  it("refuses someone outside the form's salon, and writes nothing", async () => {
    await expect(assignFollowUpOwner(form(), "acct-dm-away", CREATOR, deps)).rejects.toBeInstanceOf(FollowUpOwnerError);
    expect(store.form_instances[0]!.follow_up_owner).toBeUndefined();
    expect(store.form_instance_events).toEqual([]);
  });

  it("naming the creator (or nobody) gives it back to the creator", async () => {
    await assignFollowUpOwner(form(), "acct-dm", CREATOR, deps);
    const { instance } = await assignFollowUpOwner(form({ followUpOwner: "acct-dm" }), CREATOR, CREATOR, deps);
    expect(instance.followUpOwner).toBeNull();
  });
});

describe("the follow-up bells go to the owner and the creator", () => {
  it("rings both, once, under one claim", async () => {
    const rung: string[] = [];
    const claims: string[] = [];
    const outcome = await runFollowUpNotices(new Date("2026-12-03T18:00:00Z"), {
      list: async () => [form({ followUpOwner: "acct-dm", followUpDate: "2026-12-03" })],
      claim: async (row) => {
        claims.push(row.recipientEmail);
        return true;
      },
      emailOf: async (id) => ({ "acct-dm": "dm@example.test", [CREATOR]: "creator@example.test" })[id] ?? null,
      ring: async (rows) => {
        rung.push(...rows.map((row) => row.recipientEmail));
      },
      excludedNames: new Set(),
    });
    expect(outcome.due).toBe(1);
    expect(rung).toEqual(["dm@example.test", "creator@example.test"]);
    expect(claims).toEqual(["dm@example.test"]);
  });
});
