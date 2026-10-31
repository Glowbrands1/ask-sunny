import { describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * ============================================================================
 * THE WHOLE-STAFF LIST THROUGH THE REAL DIRECTORY READ (review item 11)
 * ============================================================================
 *
 * The chat e2e mocks `readDirectoryFacts`; this runs the real one over the
 * four tables it reads — the Woven directory, its active affiliations, the
 * reviewed location map and the salons — so the position join and the salon
 * scope are what production does. People are invented.
 */

const store = {
  employee_access_directory: [
    { id: "p-1", first_name: "Marnie", last_name: "Holloway", preferred_first_name: null, employment_status: "active", position_name: "Tanning Consultant", primary_woven_location_id: "w-309", primary_location_name: "NE Kearney" },
    { id: "p-2", first_name: "Remy", last_name: "Calder", preferred_first_name: null, employment_status: "active", position_name: "Salon Director", primary_woven_location_id: "w-309", primary_location_name: "NE Kearney" },
    { id: "p-3", first_name: "Tobin", last_name: "Areli", preferred_first_name: null, employment_status: "active", position_name: "Tanning Consultant", primary_woven_location_id: "w-307", primary_location_name: "NE Grand Island" },
    { id: "p-4", first_name: "Wren", last_name: "Galloway", preferred_first_name: null, employment_status: "terminated", position_name: "Tanning Consultant", primary_woven_location_id: "w-309", primary_location_name: "NE Kearney" },
  ],
  employee_location_affiliations: [
    { employee_id: "p-1", woven_location_id: "w-309", active: true },
    { employee_id: "p-2", woven_location_id: "w-309", active: true },
    { employee_id: "p-3", woven_location_id: "w-307", active: true },
    { employee_id: "p-4", woven_location_id: "w-309", active: true },
  ],
  woven_location_map: [
    { woven_location_id: "w-309", salon_id: "s-309", status: "mapped" },
    { woven_location_id: "w-307", salon_id: "s-307", status: "mapped" },
  ],
  salons: [
    { id: "s-309", salon_number: "0309" },
    { id: "s-307", salon_number: "0307" },
  ],
} as unknown as FakeStore;

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

const { staffPickerTurn } = await import("./staff-picker");
const ASK = "can you create a coaching form for my whole staff?";

describe("the whole-staff list, real directory read", () => {
  it("a salon account: its own salon's current staff, under Woven's position", async () => {
    const reply = await staffPickerTurn({
      question: ASK,
      history: [],
      continuing: false,
      scope: { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] } as never,
      role: "salon_director",
    });
    const content = reply?.content ?? "";
    expect(content).toContain("**NE Kearney**");
    expect(content).toMatch(/\*\*Salon Director\*\*\n- Remy Calder/);
    expect(content).toMatch(/\*\*Tanning Consultant\*\*\n- Marnie Holloway/);
    expect(content).not.toContain("Tobin Areli");
    expect(content).not.toContain("Wren Galloway");
  });

  it.each(["district", "region"])("a %s account reads no roster here: no list, asked for a name (fails closed)", async (level) => {
    const reply = await staffPickerTurn({
      question: ASK,
      history: [],
      continuing: false,
      scope: { level, primaryAreaId: `${level === "district" ? "dist" : "reg"}-test`, alsoCoversAreaIds: [] } as never,
      role: "district_manager",
    });
    const content = reply?.content ?? "";
    expect(content).toContain("can't list a staff for your account");
    expect(content).not.toMatch(/Marnie|Remy|Tobin/);
  });
});
