import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PlannedRow } from "@/lib/employees/woven/access/types";
import type { Role, ScopeLevel } from "@/types";

import { changeNoticeText, decidePositionChanges, districtOfSalon, MAX_CHANGES_PER_RUN, readPositionSyncConfig } from "./position-sync";
import { runPositionSync, type PositionSyncDeps } from "./position-sync.server";

/*
 * Pau, 28 Nov 2026: "we need to add District manager also, just not corporate , also add a sync where there is a
 * position change it should detect it and give the correct link to the person with correct position and location.
 * sometimes they make new hire DM as tanning employee but change it within the dayy to DM so we need to catch that
 * too, for new positions existing, make sure their access refreshes too depends on the access we have in the
 * intergration both app". Chosen: "All within manager tiers".
 *
 * Invented people only. Salon and district ids are the app's own.
 */

const SALON_A = "loc-0307";
const SALON_B = "loc-0313";
const DISTRICT_A = districtOfSalon(SALON_A)!;
const DISTRICT_B = districtOfSalon(SALON_B)!;

function row(over: {
  role: Role;
  level?: ScopeLevel;
  area?: string | null;
  proposedRole: Role | null;
  proposedArea?: string | null;
  status?: "active" | "invited" | "disabled";
  protectedAccount?: boolean;
  linkMethod?: string;
  woven?: "active" | "terminated" | "unknown";
  id?: string;
}): PlannedRow {
  const id = over.id ?? "E1";
  return {
    key: id,
    externalEmployeeId: id,
    appUserId: `u-${id}`,
    employeeName: "Robin Quillfeather",
    emailAddress: "robin@example.com",
    wovenStatus: over.woven ?? "active",
    wovenPosition: null,
    wovenPrimaryLocation: null,
    wovenAdditionalLocations: [],
    account: {
      appUserId: `u-${id}`,
      email: "robin@example.com",
      role: over.role,
      status: over.status ?? "active",
      scopeLevel: over.level ?? "salon",
      primaryAreaId: over.area === undefined ? SALON_A : over.area,
      management: "woven_linked",
      isProtected: over.protectedAccount ?? false,
      managed: { status: true, location: false, role: false },
      extraSalonCount: 0,
      via: "link",
      linkMethod: over.linkMethod ?? "admin_manual",
      invite: null,
    },
    proposedRole: over.proposedRole,
    proposedPrimaryAreaId: over.proposedArea === undefined ? SALON_A : over.proposedArea,
    actions: [],
    reasons: [],
    lifecycle: "NO_CHANGE",
    lifecycleReason: "",
    before: null,
    after: null,
    wovenSourceAt: null,
  } as PlannedRow;
}

const decide = (rows: PlannedRow[], also: Record<string, string[]> = {}) =>
  decidePositionChanges(rows, new Map(Object.entries(also).map(([k, v]) => [k, { alsoCoversAreaIds: v }])));

describe("who moves, and to what", () => {
  /*
   * A new hire made Tanning Consultant gets no account at all ("we dont add tanning consultants and employee"); once
   * Woven says District Manager, the lifecycle creates them as one. A Woven-created ASD corrected to DM moves here.
   */
  it("the same-day fix: a new hire made Assistant Salon Director, corrected to District Manager, becomes a DM of their salon's district", () => {
    const { changes } = decide([row({ role: "assistant_salon_director", proposedRole: "district_manager", linkMethod: "provisioned" })]);
    expect(changes).toEqual([
      expect.objectContaining({
        reason: "position_changed",
        from: { role: "assistant_salon_director", scope: { level: "salon", primaryAreaId: SALON_A, alsoCoversAreaIds: [] } },
        to: { role: "district_manager", scope: { level: "district", primaryAreaId: DISTRICT_A, alsoCoversAreaIds: [] } },
      }),
    ]);
  });

  it("promotions, demotions and moves within the tier", () => {
    const { changes } = decide([
      row({ id: "P", role: "assistant_salon_director", proposedRole: "salon_director" }),
      row({ id: "D", role: "salon_director", proposedRole: "assistant_salon_director" }),
      row({ id: "M", role: "salon_director", proposedRole: "salon_director", proposedArea: SALON_B }),
      row({ id: "X", role: "district_manager", level: "district", area: DISTRICT_A, proposedRole: "district_manager", proposedArea: SALON_B }),
      row({ id: "G", role: "district_manager", level: "district", area: DISTRICT_A, proposedRole: "salon_director", proposedArea: SALON_B }),
    ]);
    expect(DISTRICT_A).not.toBe(DISTRICT_B);
    expect(changes.map((c) => [c.externalEmployeeId, c.to.role, c.to.scope.level, c.to.scope.primaryAreaId, c.reason])).toEqual([
      ["P", "salon_director", "salon", SALON_A, "position_changed"],
      ["D", "assistant_salon_director", "salon", SALON_A, "position_changed"],
      ["M", "salon_director", "salon", SALON_B, "location_changed"],
      ["X", "district_manager", "district", DISTRICT_B, "location_changed"],
      ["G", "salon_director", "salon", SALON_B, "position_changed"],
    ]);
  });

  it("a Woven-created District Manager (made at their salon) is widened to the district", () => {
    const { changes } = decide([row({ role: "district_manager", proposedRole: "district_manager", linkMethod: "provisioned" })]);
    expect(changes).toEqual([expect.objectContaining({ reason: "created_by_woven_widened", to: { role: "district_manager", scope: { level: "district", primaryAreaId: DISTRICT_A, alsoCoversAreaIds: [] } } })]);
  });

  it("a District Manager an admin gave every salon is not narrowed: that is not a Woven change", () => {
    expect(decide([row({ role: "district_manager", level: "global", area: null, proposedRole: "district_manager" })]).changes).toEqual([]);
  });

  it("extra salons an admin granted stay", () => {
    const { changes } = decide([row({ role: "assistant_salon_director", proposedRole: "salon_director" })], { "u-E1": ["loc-0310"] });
    expect(changes[0].to.scope.alsoCoversAreaIds).toEqual(["loc-0310"]);
  });

  it("never: protected or admin accounts, regional or corporate, unmapped positions, non-salon locations, people not Active, disabled accounts", () => {
    const { changes, skipped } = decide([
      row({ id: "1", role: "salon_director", proposedRole: "district_manager", protectedAccount: true }),
      row({ id: "2", role: "regional_manager", level: "region", area: "reg-x", proposedRole: "salon_director" }),
      row({ id: "3", role: "salon_director", proposedRole: "admin" }),
      row({ id: "4", role: "salon_director", proposedRole: null }),
      row({ id: "5", role: "salon_director", proposedRole: "district_manager", proposedArea: null }),
      row({ id: "6", role: "salon_director", proposedRole: "assistant_salon_director", woven: "terminated" }),
      row({ id: "7", role: "salon_director", proposedRole: "assistant_salon_director", status: "disabled" }),
      // "we dont add tanning consultants and employee": a manager Woven now shows as one is left to an admin.
      row({ id: "8", role: "salon_director", proposedRole: "employee" }),
    ]);
    expect(changes).toEqual([]);
    expect(skipped.map((s) => s.reason).sort()).toEqual([
      "new_position_outside_the_tier",
      "new_position_outside_the_tier",
      "outside_the_tier",
      "position_not_mapped",
      "woven_primary_location_not_a_salon",
    ]);
  });

  it("the admins' bell says who, from what, to what", () => {
    const [change] = decide([row({ role: "assistant_salon_director", proposedRole: "district_manager", linkMethod: "provisioned" })]).changes;
    expect(changeNoticeText(change)).toEqual({
      title: "Access updated from Woven: Robin Quillfeather",
      body: `Robin Quillfeather's Ask Sunny access now follows Woven: Assistant Salon Director (${SALON_A}) → District Manager (${DISTRICT_A}).`,
    });
  });
});

describe("runPositionSync", () => {
  const ON = { WOVEN_POSITION_SYNC_ENABLED: "true", WOVEN_POSITION_SYNC_ACTOR: "admin@example.com" };
  const plan = (rows: PlannedRow[], mutationsAllowed = true) => ({ rows, guard: { mutationsAllowed } }) as never;
  const deps = (rows: PlannedRow[], over: Partial<PositionSyncDeps> = {}) => {
    const applied: string[] = [];
    const told: number[] = [];
    const d: PositionSyncDeps & { applied: string[]; told: number[] } = {
      applied,
      told,
      actor: vi.fn(async () => ({ id: "admin-id", email: "admin@example.com", role: "admin" as Role })),
      loadPlan: vi.fn(async () => plan(rows)),
      alsoCovers: vi.fn(async () => new Map()),
      apply: vi.fn(async (change) => void applied.push(change.externalEmployeeId)),
      tellAdmins: vi.fn(async (changes) => void told.push(changes.length)),
      ...over,
    };
    return d;
  };

  it("off by default, and without an admin to act as", async () => {
    expect(readPositionSyncConfig({})).toEqual({ enabled: false, actorEmail: null });
    const d = deps([row({ role: "assistant_salon_director", proposedRole: "salon_director" })]);
    expect(await runPositionSync({ env: {} }, d)).toEqual({ status: "off" });
    expect(await runPositionSync({ env: { WOVEN_POSITION_SYNC_ENABLED: "true" } }, d)).toEqual({ status: "off", code: "actor_missing" });
    expect(await runPositionSync({ env: ON }, { ...d, actor: async () => null })).toEqual({ status: "off", code: "actor_not_an_administrator" });
    expect(d.apply).not.toHaveBeenCalled();
  });

  it("applies each change in the admin's name and tells the admins", async () => {
    const d = deps([row({ id: "A", role: "assistant_salon_director", proposedRole: "district_manager", linkMethod: "provisioned" }), row({ id: "B", role: "salon_director", proposedRole: "salon_director" })]);
    expect(await runPositionSync({ env: ON }, d)).toEqual({ status: "completed", applied: 1, failed: 0, skipped: 0 });
    expect(d.applied).toEqual(["A"]);
    expect(d.told).toEqual([1]);
  });

  it("nothing while the guards stop changes, or when more than the cap would change at once", async () => {
    const one = row({ role: "assistant_salon_director", proposedRole: "salon_director" });
    expect(await runPositionSync({ env: ON }, deps([one], { loadPlan: async () => plan([one], false) }))).toEqual({ status: "blocked", code: "guards" });
    const many = Array.from({ length: MAX_CHANGES_PER_RUN + 1 }, (_, i) => row({ id: `E${i}`, role: "assistant_salon_director", proposedRole: "salon_director" }));
    const d = deps(many);
    expect(await runPositionSync({ env: ON }, d)).toEqual({ status: "blocked", code: "too_many_changes", changes: MAX_CHANGES_PER_RUN + 1 });
    expect(d.apply).not.toHaveBeenCalled();
  });

  it("never changes the admin it acts as; a refused change is counted, the rest go on", async () => {
    const self = { ...row({ id: "S", role: "assistant_salon_director", proposedRole: "salon_director" }) };
    self.account = { ...self.account!, appUserId: "admin-id" };
    const d = deps([self, row({ id: "F", role: "assistant_salon_director", proposedRole: "salon_director" }), row({ id: "K", role: "assistant_salon_director", proposedRole: "salon_director" })], {
      apply: vi.fn(async (change) => {
        if (change.externalEmployeeId === "F") throw new Error("refused");
      }),
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runPositionSync({ env: ON }, d)).toEqual({ status: "completed", applied: 1, failed: 1, skipped: 0 });
    errors.mockRestore();
  });
});
