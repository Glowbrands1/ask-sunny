import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope } from "@/types";

/**
 * QA's f056 (20 Nov 2026): one chat reply read the staff list 5 to 8 times per card. Within one request
 * (`withRosterReadsOncePerReply`), each raw directory read runs once per access scope; never across requests (so never
 * across managers or turns); a failed read is not kept; outside a request every call reads, as before.
 */

const tables = {
  employee_access_directory: [
    { id: "e-1", first_name: "Remy", last_name: "Calder", preferred_first_name: null, employment_status: "active", position_name: "Tanning Consultant", primary_woven_location_id: "w-309", primary_location_name: "NE Kearney" },
    { id: "e-2", first_name: "Juno", last_name: "Paxton", preferred_first_name: null, employment_status: "active", position_name: "Tanning Consultant", primary_woven_location_id: "w-306", primary_location_name: "NE Other" },
  ],
  employee_location_affiliations: [
    { employee_id: "e-1", woven_location_id: "w-309", active: true },
    { employee_id: "e-2", woven_location_id: "w-306", active: true },
  ],
  woven_location_map: [
    { woven_location_id: "w-309", salon_id: "s-309", status: "mapped" },
    { woven_location_id: "w-306", salon_id: "s-306", status: "mapped" },
  ],
  salons: [
    { id: "s-309", salon_number: "0309" },
    { id: "s-306", salon_number: "0306" },
  ],
} as unknown as FakeStore;

const reads = vi.hoisted(() => ({ count: 0, fail: false }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      reads.count += 1;
      if (reads.fail) throw new Error("directory down");
      return fakeSupabase(tables).from(table);
    },
  }),
}));

vi.mock("@/lib/config/chat-quality-flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/chat-quality-flags")>()),
  rosterStoreScopedEnabled: () => false,
}));

const { loadScopedRoster, readDirectoryFacts, readScopedRoster, withRosterReadsOncePerReply } = await import("./employee-roster");

const KEARNEY: AccessScope = { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] };
const OTHER: AccessScope = { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: [] };

async function oneCard(scope: AccessScope) {
  /* What one card's turn does today: find_staff, propose_form's checks, the name question, the title, the old path. */
  const rosters = await Promise.all([readScopedRoster(scope), readScopedRoster(scope), loadScopedRoster(scope)]);
  const facts = await Promise.all([readDirectoryFacts(scope), readDirectoryFacts(scope)]);
  const again = await readScopedRoster(scope);
  return { rosters, facts, again };
}

describe("the staff list is read once per reply (f056)", () => {
  beforeEach(() => {
    reads.count = 0;
    reads.fail = false;
  });

  it("outside a request every call reads, as before", async () => {
    await oneCard(KEARNEY);
    expect(reads.count).toBe(6 * 4);
  });

  it("within one request each read runs once per scope, and every caller gets the same rows", async () => {
    const outside = await oneCard(KEARNEY);
    reads.count = 0;
    const inside = await withRosterReadsOncePerReply(() => oneCard(KEARNEY));
    /* One directory read (4 tables) for the roster and one for the facts. */
    expect(reads.count).toBe(2 * 4);
    expect(inside).toEqual(outside);
    expect(inside.rosters[0]!.map((person) => person.id)).toEqual(["e-1"]);
  });

  it("each caller gets its own copy: a caller changing its list changes nobody else's", async () => {
    await withRosterReadsOncePerReply(async () => {
      const first = await readScopedRoster(KEARNEY);
      first.length = 0;
      expect(await readScopedRoster(KEARNEY)).toHaveLength(1);
    });
  });

  it("never across requests (managers or turns), and another scope is read on its own", async () => {
    await withRosterReadsOncePerReply(() => oneCard(KEARNEY));
    await withRosterReadsOncePerReply(() => oneCard(KEARNEY));
    expect(reads.count).toBe(2 * 2 * 4);
    reads.count = 0;
    const [kearney, other] = await withRosterReadsOncePerReply(() => Promise.all([readDirectoryFacts(KEARNEY), readDirectoryFacts(OTHER)]));
    expect(reads.count).toBe(2 * 4);
    expect(kearney.map((person) => person.id)).toEqual(["e-1"]);
    expect(other.map((person) => person.id)).toEqual(["e-2"]);
  });

  it("a failed read is not kept: the next caller in the same request reads again", async () => {
    await withRosterReadsOncePerReply(async () => {
      reads.fail = true;
      await expect(readScopedRoster(KEARNEY)).rejects.toThrow();
      reads.fail = false;
      expect((await readScopedRoster(KEARNEY)).map((person) => person.id)).toEqual(["e-1"]);
    });
  });
});
