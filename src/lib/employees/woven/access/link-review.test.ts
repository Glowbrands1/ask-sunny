import { describe, expect, it } from "vitest";

import { allowedManagedFlags, decideLinkReview, LinkReviewError, parseLinkReview, pendingLinkReviews } from "./link-review";
import { planAccess } from "./plan";
import type { PlannerAccount, PlannerEmployee, PlannerInput } from "./types";

/**
 * LINK REVIEW: only a match the planner proposes NOW can be confirmed; what
 * Woven may manage is opt-in and bounded; once confirmed, the EmployeeID —
 * never the email — identifies the account.
 */

const positions: PlannerInput["positions"] = [
  { wovenPositionId: "P-SD", status: "mapped", isConfirmed: true, role: "salon_director", scopeLevel: "salon" },
  { wovenPositionId: "P-DM", status: "mapped", isConfirmed: true, role: "district_manager", scopeLevel: "district" },
];
const locations: PlannerInput["locations"] = [
  { wovenLocationId: "L-GI", status: "mapped", salonNumber: "0307", name: "NE Grand Island" },
  { wovenLocationId: "L-LIB", status: "mapped", salonNumber: "0394", name: "KC Liberty" },
];

const employee = (id: string, over: Partial<PlannerEmployee> = {}): PlannerEmployee => ({
  externalEmployeeId: id,
  name: `Person ${id}`,
  emailAddress: `${id.toLowerCase()}@gmail.com`,
  employmentStatus: "active",
  missingSyncCount: 0,
  positionId: "P-SD",
  positionName: "Salon Director",
  primaryWovenLocationId: "L-GI",
  primaryLocationName: "NE Grand Island",
  additionalLocationNames: [],
  issues: [],
  terminationDate: null,
  lastSyncedAt: "2026-10-03T11:17:50Z",
  ...over,
});

const account = (n: number, over: Partial<PlannerAccount> = {}): PlannerAccount => ({
  appUserId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  email: `a${n}@gmail.com`,
  displayName: `Account ${n}`,
  role: "salon_director",
  status: "active",
  scopeLevel: "salon",
  primaryAreaId: "loc-0307",
  alsoCoversAreaIds: [],
  management: null,
  linkedExternalEmployeeId: null,
  linkMethod: null,
  managedStatus: false,
  managedLocation: false,
  managedRole: false,
  terminatedAt: null,
  accessRevokedAt: null,
  override: null,
  ...over,
});

const REVIEWER = "admin:owner@suntancity.com";
const plan = (employees: PlannerEmployee[], accounts: PlannerAccount[]) => planAccess({ employees, positions, locations, accounts });
const input = (appUserId: string, externalEmployeeId: string, over: Record<string, unknown> = {}) =>
  parseLinkReview({ appUserId, externalEmployeeId, decision: "confirm", samePersonConfirmed: true, ...over });

describe("parseLinkReview", () => {
  it("requires an account id, a Woven EmployeeID, a decision — and an explicit same-person confirmation", () => {
    const id = account(1).appUserId;
    expect(() => parseLinkReview({ appUserId: "nope", externalEmployeeId: "E1", decision: "confirm", samePersonConfirmed: true })).toThrow(LinkReviewError);
    expect(() => parseLinkReview({ appUserId: id, externalEmployeeId: "bad id!", decision: "confirm", samePersonConfirmed: true })).toThrow(LinkReviewError);
    expect(() => parseLinkReview({ appUserId: id, externalEmployeeId: "E1", decision: "merge" })).toThrow(LinkReviewError);
    expect(() => parseLinkReview({ appUserId: id, externalEmployeeId: "E1", decision: "confirm" })).toThrow(/same person/);
    expect(parseLinkReview({ appUserId: id, externalEmployeeId: "E1", decision: "not_woven_managed" }).decision).toBe("not_woven_managed");
  });

  it("managed flags are false unless literally true", () => {
    const parsed = input(account(1).appUserId, "E1", { managedStatus: "yes", managedLocation: 1, managedRole: true });
    expect([parsed.managedStatus, parsed.managedLocation, parsed.managedRole]).toEqual([false, false, true]);
  });
});

describe("decideLinkReview", () => {
  it("confirms a pending exact-email match into a durable woven_linked row, flags off by default", () => {
    const e = employee("E1");
    const a = account(1, { email: "E1@Gmail.com" });
    const rows = plan([e], [a]);
    expect(pendingLinkReviews(rows)).toHaveLength(1);
    expect(decideLinkReview(rows, input(a.appUserId, "E1"), REVIEWER)).toEqual({
      app_user_id: a.appUserId,
      management: "woven_linked",
      external_employee_id: "E1",
      link_method: "admin_confirmed_email",
      managed_status: false,
      managed_location: false,
      managed_role: false,
      reason: "Exact email match confirmed by a person",
      set_by: REVIEWER,
    });
  });

  it("records 'different person' as not Woven-managed, managing nothing", () => {
    const e = employee("E1");
    const a = account(1, { email: "e1@gmail.com" });
    const row = decideLinkReview(plan([e], [a]), input(a.appUserId, "E1", { decision: "not_woven_managed" }), REVIEWER);
    expect(row).toMatchObject({ management: "not_woven_managed", external_employee_id: null, managed_status: false, managed_location: false, managed_role: false });
  });

  it.each([
    ["the wrong employee for that account", (a: PlannerAccount) => input(a.appUserId, "E2")],
    ["an account that is not the candidate", () => input(account(99).appUserId, "E1")],
  ])("refuses %s (not pending)", (_name, make) => {
    const a = account(1, { email: "e1@gmail.com" });
    const rows = plan([employee("E1"), employee("E2")], [a]);
    expect(() => decideLinkReview(rows, make(a), REVIEWER)).toThrow(expect.objectContaining({ code: "not_pending", status: 409 }));
  });

  it("refuses an ambiguous match: two Woven employees share the email", () => {
    const a = account(1, { email: "shared@gmail.com" });
    const rows = plan([employee("E1", { emailAddress: "shared@gmail.com" }), employee("E2", { emailAddress: "shared@gmail.com" })], [a]);
    expect(pendingLinkReviews(rows)).toEqual([]);
    expect(() => decideLinkReview(rows, input(a.appUserId, "E1"), REVIEWER)).toThrow(expect.objectContaining({ code: "not_pending" }));
  });

  it("refuses an account that is already linked or classified", () => {
    const linked = account(1, { email: "e1@gmail.com", management: "woven_linked", linkedExternalEmployeeId: "E9" });
    const external = account(2, { email: "e2@gmail.com", management: "not_woven_managed" });
    const rows = plan([employee("E1"), employee("E2"), employee("E9")], [linked, external]);
    expect(() => decideLinkReview(rows, input(linked.appUserId, "E1"), REVIEWER)).toThrow(expect.objectContaining({ code: "not_pending" }));
    expect(() => decideLinkReview(rows, input(external.appUserId, "E2"), REVIEWER)).toThrow(expect.objectContaining({ code: "not_pending" }));
  });

  it("bounds what Woven may manage: a District Manager at global scope can be linked, but location and role stay off", () => {
    const e = employee("E1", { positionId: "P-DM", positionName: "District Manager" });
    const dm = account(1, { email: "e1@gmail.com", role: "district_manager", scopeLevel: "global", primaryAreaId: null });
    const row = decideLinkReview(plan([e], [dm]), input(dm.appUserId, "E1", { managedStatus: true, managedLocation: true, managedRole: true }), REVIEWER);
    expect([row.managed_status, row.managed_location, row.managed_role]).toEqual([true, false, false]);
  });

  it("an administrator can be linked, but Woven may never manage its status", () => {
    const admin = account(1, { email: "e1@gmail.com", role: "admin", scopeLevel: "global", primaryAreaId: null });
    const row = decideLinkReview(plan([employee("E1")], [admin]), input(admin.appUserId, "E1", { managedStatus: true }), REVIEWER);
    expect(row.managed_status).toBe(false);
    expect(allowedManagedFlags({ role: "owner", scopeLevel: "global" }, false)).toEqual({ status: false, location: false, role: false });
  });

  it("a salon-scope Salon Director may opt in to all three", () => {
    const a = account(1, { email: "e1@gmail.com" });
    const row = decideLinkReview(plan([employee("E1")], [a]), input(a.appUserId, "E1", { managedStatus: true, managedLocation: true, managedRole: true }), REVIEWER);
    expect([row.managed_status, row.managed_location, row.managed_role]).toEqual([true, true, true]);
  });
});

describe("after confirmation the EmployeeID is authoritative and email matching stops", () => {
  function confirmed(e: PlannerEmployee, a: PlannerAccount, flags: Partial<PlannerAccount> = {}): PlannerAccount {
    const row = decideLinkReview(plan([e], [a]), input(a.appUserId, e.externalEmployeeId), REVIEWER);
    return { ...a, management: row.management, linkedExternalEmployeeId: row.external_employee_id, linkMethod: row.link_method, ...flags };
  }

  it("the link review disappears and the account is found by EmployeeID", () => {
    const e = employee("E1");
    const a = confirmed(e, account(1, { email: "e1@gmail.com" }));
    const rows = plan([e], [a]);
    expect(pendingLinkReviews(rows)).toEqual([]);
    expect(rows.find((r) => r.externalEmployeeId === "E1")!.account).toMatchObject({ appUserId: a.appUserId, via: "link" });
  });

  it("if Woven's email later changes, the same account stays linked (email-change review), never re-matched or duplicated", () => {
    const e = employee("E1");
    const a = confirmed(e, account(1, { email: "e1@gmail.com" }));
    const moved = { ...e, emailAddress: "new.address@gmail.com" };
    const rows = plan([moved], [a]);
    expect(rows.find((r) => r.externalEmployeeId === "E1")).toMatchObject({ actions: ["FLAG_EMAIL_CHANGE_REVIEW"], account: { appUserId: a.appUserId, via: "link" } });
    expect(rows.filter((r) => r.actions.includes("CREATE_USER"))).toEqual([]);
  });

  it("another Woven employee who later shows the account's email is not matched to it", () => {
    const e = employee("E1");
    const a = confirmed(e, account(1, { email: "e1@gmail.com" }));
    const other = employee("E2", { emailAddress: "e1@gmail.com" });
    const rows = plan([e, other], [a]);
    expect(rows.find((r) => r.externalEmployeeId === "E2")!.actions).not.toContain("FLAG_LINK_REVIEW");
    expect(pendingLinkReviews(rows)).toEqual([]);
  });

  it("confirming a link changes nothing by itself: with every flag off, no mutation is proposed", () => {
    const e = employee("E1", { primaryWovenLocationId: "L-LIB" });
    const a = confirmed(e, account(1, { email: "e1@gmail.com", primaryAreaId: "loc-0307" }));
    const rows = plan([e], [a]);
    expect(rows.flatMap((r) => r.actions).filter((x) => ["CREATE_USER", "UPDATE_PRIMARY_LOCATION", "UPDATE_ROLE", "DISABLE_TERMINATED"].includes(x))).toEqual([]);
  });
});
