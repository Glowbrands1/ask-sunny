import { describe, expect, it } from "vitest";

import { WovenClient } from "./client";
import { readWovenConfig } from "./config";
import { MemoryDirectoryStore } from "./memory-store";
import { resolveEmployeeRole, roleWriteAllowed, type PositionMapping, type RoleOverride } from "./role-resolution";
import { runWovenEmployeeSync } from "./sync";
import { createFakeWoven, FAKE_CREDENTIALS, wovenEmployee } from "./test-support";

/**
 * PROTECTED OVERRIDE → CONFIRMED POSITION → NOTHING. The same order the SQL
 * view states (employee_access_preview.effective_role); the migration verifier
 * pins that side.
 */

const ADMIN: RoleOverride = { role: "admin", scopeLevel: "global" };
const CONSULTANT: PositionMapping = { isConfirmed: true, role: "employee", scopeLevel: "salon" };
const SALON_DIRECTOR: PositionMapping = { isConfirmed: true, role: "salon_director", scopeLevel: "salon" };
const UNCONFIRMED_OPERATIONS: PositionMapping = { isConfirmed: false, role: null, scopeLevel: null };

describe("resolveEmployeeRole", () => {
  it("a protected override wins over any position", () => {
    for (const position of [CONSULTANT, SALON_DIRECTOR, UNCONFIRMED_OPERATIONS, null]) {
      expect(resolveEmployeeRole(ADMIN, position)).toEqual({ role: "admin", scopeLevel: "global", source: "override" });
    }
  });

  it("without an override, a confirmed position decides", () => {
    expect(resolveEmployeeRole(null, CONSULTANT)).toEqual({ role: "employee", scopeLevel: "salon", source: "position" });
  });

  it("an unconfirmed or unmapped position (Operations, Maintenance, …) resolves to nothing — never admin", () => {
    expect(resolveEmployeeRole(null, UNCONFIRMED_OPERATIONS)).toEqual({ role: null, scopeLevel: null, source: "none" });
    expect(resolveEmployeeRole(null, null)).toEqual({ role: null, scopeLevel: null, source: "none" });
    /* A mapping a person has not confirmed is not used, even with a role on it. */
    expect(resolveEmployeeRole(null, { isConfirmed: false, role: "admin", scopeLevel: "global" }).role).toBeNull();
  });
});

describe("roleWriteAllowed: what a later role-application step may write", () => {
  it("never demotes or replaces a protected admin", () => {
    for (const proposed of ["employee", "assistant_salon_director", "salon_director", "district_manager", "regional_manager", "owner"] as const) {
      expect(roleWriteAllowed(proposed, ADMIN, CONSULTANT), proposed).toBe(false);
    }
    expect(roleWriteAllowed("admin", ADMIN, CONSULTANT)).toBe(true);
  });

  it("never gives admin to a colleague who shares a protected person's position", () => {
    expect(roleWriteAllowed("admin", null, UNCONFIRMED_OPERATIONS)).toBe(false);
    expect(roleWriteAllowed("admin", null, CONSULTANT)).toBe(false);
    expect(roleWriteAllowed("employee", null, CONSULTANT)).toBe(true);
  });
});

describe("a later employee sync cannot demote the protected admins", { timeout: 60_000 }, () => {
  it("position changes for a protected employee are recorded as history only; the resolution stays admin", async () => {
    const CONFIG = readWovenConfig({
      WOVEN_SYNC_ENABLED: "true",
      WOVEN_SYNC_WRITES_ENABLED: "true",
      WOVEN_SUBSCRIPTION_KEY: FAKE_CREDENTIALS.subscriptionKey,
      WOVEN_USERNAME: FAKE_CREDENTIALS.username,
      WOVEN_PASSWORD: FAKE_CREDENTIALS.password,
    });
    /* 9001: protected (Operations in Woven). 9002: the same position, not protected. */
    const employees = [
      wovenEmployee("9001", { positionId: "POS-OPS", positionName: "Operations" }),
      wovenEmployee("9002", { positionId: "POS-OPS", positionName: "Operations" }),
    ];
    const fake = createFakeWoven({ employees, tokenLifetimeSeconds: 3600 });
    const store = new MemoryDirectoryStore();
    const run = async () => {
      const outcome = await runWovenEmployeeSync({
        requestedBy: "cron",
        config: CONFIG,
        store,
        now: () => new Date("2026-09-30T11:00:00Z"),
        client: new WovenClient({ baseUrl: CONFIG.baseUrl, credentials: FAKE_CREDENTIALS, fetch: fake.fetch, sleep: async () => {} }),
      });
      if (outcome.status !== "succeeded") throw new Error(JSON.stringify(outcome));
      return outcome.summary;
    };
    await run();

    /* Woven moves the protected person to a salon position. */
    employees[0] = wovenEmployee("9001", { positionId: "POS-SC", positionName: "Tanning Consultant" });
    const later = await run();
    expect(later.changesByKind.position_changed).toBe(1);
    expect(store.changes.find((c) => c.kind === "position_changed")?.classification).toBe("unclassified");

    /* The directory store has no role, account or scope method to call — the sync cannot write one. */
    const methods = Object.getOwnPropertyNames(MemoryDirectoryStore.prototype);
    expect(methods.some((m) => /role|user|scope|login|auth/i.test(m))).toBe(false);

    /* And whatever the new position maps to, the protected account resolves to admin; the colleague does not. */
    expect(resolveEmployeeRole(ADMIN, CONSULTANT).role).toBe("admin");
    expect(resolveEmployeeRole(null, UNCONFIRMED_OPERATIONS).role).toBeNull();
  });
});
