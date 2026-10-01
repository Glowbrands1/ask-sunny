import { describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * THE DIRECTORY READ: Woven people, their active affiliations, the location
 * map a PERSON reviewed, and the salons table — joined to the `loc-NNNN` ids
 * every Ask Sunny scope uses. An unmapped Woven location is no salon at all.
 */

const store = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  employee_access_directory: [
    { id: "p-1", first_name: "Kaitlyn", last_name: "Marsh", preferred_first_name: null, employment_status: "active" },
    { id: "p-2", first_name: "Avery", last_name: "Stone", preferred_first_name: "Ave", employment_status: "active" },
    { id: "p-3", first_name: "Gone", last_name: "Person", preferred_first_name: null, employment_status: "terminated" },
  ],
  employee_location_affiliations: [
    { employee_id: "p-1", woven_location_id: "w-310", active: true },
    { employee_id: "p-2", woven_location_id: "w-310", active: true },
    { employee_id: "p-2", woven_location_id: "w-311", active: true },
    // Ended, so not a current assignment.
    { employee_id: "p-1", woven_location_id: "w-311", active: false },
    // Mapped by nobody yet.
    { employee_id: "p-2", woven_location_id: "w-unmapped", active: true },
    { employee_id: "p-3", woven_location_id: "w-310", active: true },
  ],
  woven_location_map: [
    { woven_location_id: "w-310", salon_id: "s-310", status: "mapped" },
    { woven_location_id: "w-311", salon_id: "s-311", status: "mapped" },
    { woven_location_id: "w-unmapped", salon_id: null, status: "unmapped" },
  ],
  salons: [
    { id: "s-310", salon_number: "0310" },
    { id: "s-311", salon_number: "0311" },
  ],
} as unknown as FakeStore;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

const { loadScopedRoster, readDirectoryRoster } = await import("./employee-roster");

describe("reading the employee directory", () => {
  it("joins people to Ask Sunny salons through the reviewed location map only", async () => {
    const rows = await readDirectoryRoster();
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.salonIds]));
    expect(byId["p-1"]).toEqual(["loc-0310"]);
    expect(byId["p-2"]).toEqual(["loc-0310", "loc-0311"]);
  });

  it("scopes to the actor before anything leaves the server", async () => {
    const roster = await loadScopedRoster({ level: "salon", primaryAreaId: "loc-0311", alsoCoversAreaIds: [] });
    expect(roster.map((entry) => entry.id)).toEqual(["p-2"]);
    expect(roster[0]!.salonIds).toEqual(["loc-0311"]);
  });

  it("fails to an empty roster, never to everyone, when the directory cannot be read", async () => {
    const saved = store.form_instances;
    delete (store as unknown as Record<string, unknown>).salons;
    try {
      expect(await loadScopedRoster({ level: "global", primaryAreaId: null, alsoCoversAreaIds: [] })).toEqual([]);
    } finally {
      (store as unknown as Record<string, unknown>).salons = [
        { id: "s-310", salon_number: "0310" },
        { id: "s-311", salon_number: "0311" },
      ];
      store.form_instances = saved;
    }
  });
});
