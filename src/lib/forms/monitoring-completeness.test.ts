import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * ============================================================================
 * REMEDIATION 2, FINDING 3 — FILTER BEFORE THE LIMIT, NOT AFTER IT
 * ============================================================================
 *
 * THE DEFECT. `listInstances` ordered the WHOLE COMPANY by recency, took the
 * first 200, and the route filtered that page down to the caller's own salon.
 * Confidential enough — no foreign row ever reached the browser — and wrong as
 * a history.
 *
 * With 22 locations it is a matter of time: 200 newer records exist across
 * other salons, one salon's own still-relevant record is number 201 by date, it
 * never enters the page, and no filter can return what the query never
 * fetched. Its manager opens Form Monitoring to find their own history has
 * quietly lost rows — with nothing on screen saying so.
 *
 * NOT FIXED BY RAISING 200. That trades a wrong answer for a later wrong answer
 * and a bigger payload. The ordering of filter and limit is the bug.
 *
 * These run against the fake client rather than a mocked `listInstances`,
 * because the fix IS the query: a test that mocked it away would assert only
 * that mocks return what they were told to.
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

const { listInstances } = await import("./instances");

const VERSION_ID = "version-1";

/** ISO timestamps that sort correctly as strings, oldest first. */
function at(minute: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
}

function row(overrides: Record<string, unknown>) {
  return {
    id: `form-${Math.random().toString(36).slice(2)}`,
    template_id: "tpl-1",
    template_key: "coaching",
    template_name: "Coaching Form",
    template_short_name: "Coaching",
    layout_family: "coaching",
    template_version_id: VERSION_ID,
    template_version: 1,
    variant_key: null,
    employee_name: "Synthetic Person",
    employee_role: null,
    location_id: null,
    location_name: null,
    created_by: "user-a",
    created_by_role: "salon_director",
    source: "manual",
    status: "draft",
    form_date: "2026-01-01",
    follow_up_date: null,
    followed_up_at: null,
    followed_up_by: null,
    finalized_at: null,
    exported_at: null,
    archived_at: null,
    revises_instance_id: null,
    created_at: at(0),
    updated_at: at(0),
    ...overrides,
  };
}

const OLD_SALON_A = "the-record-that-vanished";

beforeEach(() => {
  store.form_instances.length = 0;

  /*
   * THE ADVERSARIAL SHAPE, and it is deliberately just over the boundary: 260
   * foreign records, every one of them NEWER than the salon-A record that
   * matters. Under the old ordering the salon-A row is beyond the 200 the query
   * fetched, so nothing downstream could ever return it.
   */
  store.form_instances.push(
    row({ id: OLD_SALON_A, location_id: "loc-a", created_at: at(1), updated_at: at(1) }),
  );
  for (let index = 0; index < 260; index += 1) {
    store.form_instances.push(
      row({
        id: `foreign-${index}`,
        location_id: `loc-other-${index % 21}`,
        created_by: "user-elsewhere",
        created_at: at(100 + index),
        updated_at: at(100 + index),
      }),
    );
  }
});

describe("R2-F3. the fixture really does bury the salon's record", () => {
  it("puts 260 newer foreign rows in front of it", async () => {
    // The guard on the guard: without a filter it is genuinely off the page,
    // so the test below is measuring the query and not the fixture.
    const unrestricted = await listInstances("active", 200);

    expect(unrestricted).toHaveLength(200);
    expect(unrestricted.map((entry) => entry.id)).not.toContain(OLD_SALON_A);
  });
});

describe("R2-F3. an authorized record survives any volume of foreign ones", () => {
  it("returns it despite 260 newer records elsewhere", async () => {
    const visible = await listInstances("active", 200, {
      locationIds: ["loc-a"],
      ownNullLocationCreatedBy: "user-a",
    });

    expect(visible.map((entry) => entry.id)).toContain(OLD_SALON_A);
  });

  it("returns no foreign row at all", async () => {
    const visible = await listInstances("active", 200, {
      locationIds: ["loc-a"],
      ownNullLocationCreatedBy: "user-a",
    });

    for (const entry of visible) {
      expect(entry.locationId === null || entry.locationId === "loc-a", entry.id).toBe(true);
    }
  });

  it("includes the caller's own record that names no salon", async () => {
    store.form_instances.push(
      row({ id: "mine-no-salon", location_id: null, created_by: "user-a", created_at: at(2) }),
    );

    const visible = await listInstances("active", 200, {
      locationIds: ["loc-a"],
      ownNullLocationCreatedBy: "user-a",
    });

    expect(visible.map((entry) => entry.id)).toContain("mine-no-salon");
    expect(visible.map((entry) => entry.id)).toContain(OLD_SALON_A);
  });

  it("excludes somebody else's record that names no salon", async () => {
    store.form_instances.push(
      row({ id: "theirs-no-salon", location_id: null, created_by: "user-b", created_at: at(3) }),
    );

    const visible = await listInstances("active", 200, {
      locationIds: ["loc-a"],
      ownNullLocationCreatedBy: "user-a",
    });

    expect(visible.map((entry) => entry.id)).not.toContain("theirs-no-salon");
  });
});

describe("R2-F3. the limit applies to the VISIBLE set", () => {
  it("bounds the merged result rather than the company-wide one", async () => {
    for (let index = 0; index < 250; index += 1) {
      store.form_instances.push(
        row({ id: `mine-${index}`, location_id: "loc-a", created_at: at(1000 + index) }),
      );
    }

    const visible = await listInstances("active", 200, {
      locationIds: ["loc-a"],
      ownNullLocationCreatedBy: "user-a",
    });

    // Bounded, and bounded by the caller's own rows rather than the company's.
    expect(visible).toHaveLength(200);
    for (const entry of visible) expect(entry.locationId).toBe("loc-a");
  });

  it("returns the merged set newest first", async () => {
    store.form_instances.push(
      row({ id: "mine-newer", location_id: null, created_by: "user-a", created_at: at(5000) }),
    );

    const visible = await listInstances("active", 200, {
      locationIds: ["loc-a"],
      ownNullLocationCreatedBy: "user-a",
    });

    expect(visible[0]!.id).toBe("mine-newer");
    const dates = visible.map((entry) => entry.createdAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("de-duplicates across the two reads", async () => {
    const visible = await listInstances("active", 200, {
      locationIds: ["loc-a"],
      ownNullLocationCreatedBy: "user-a",
    });
    expect(new Set(visible.map((entry) => entry.id)).size).toBe(visible.length);
  });
});

describe("R2-F3. district and region stay fail-closed on the list too", () => {
  it("returns nothing for an empty authorized-salon set", async () => {
    // `authorizedSalonIds` yields nothing for any level but `salon`, so an
    // empty list is how a district manager's read is expressed.
    const visible = await listInstances("active", 200, { locationIds: [] });
    expect(visible).toEqual([]);
  });

  it("still returns their own null-location records", async () => {
    store.form_instances.push(
      row({ id: "dm-own", location_id: null, created_by: "user-dm", created_at: at(4) }),
    );

    const visible = await listInstances("active", 200, {
      locationIds: [],
      ownNullLocationCreatedBy: "user-dm",
    });

    expect(visible.map((entry) => entry.id)).toEqual(["dm-own"]);
  });
});

describe("R2-F3. a global actor keeps the ordinary bounded read", () => {
  it("gets one ordered, limited query across everything", async () => {
    const visible = await listInstances("active", 200);

    expect(visible).toHaveLength(200);
    // Newest first, unchanged.
    expect(visible[0]!.id).toBe("foreign-259");
  });

  it("behaves the same when the filter names no location restriction", async () => {
    const visible = await listInstances("active", 200, {
      ownNullLocationCreatedBy: "user-a",
    });
    expect(visible).toHaveLength(200);
    expect(visible[0]!.id).toBe("foreign-259");
  });
});

describe("R2-F3. the archived view is filtered the same way", () => {
  it("narrows by salon before limiting", async () => {
    store.form_instances.push(
      row({
        id: "archived-mine",
        location_id: "loc-a",
        archived_at: at(9),
        created_at: at(4),
      }),
    );

    const active = await listInstances("active", 200, { locationIds: ["loc-a"] });
    const archived = await listInstances("archived", 200, { locationIds: ["loc-a"] });

    expect(active.map((entry) => entry.id)).not.toContain("archived-mine");
    expect(archived.map((entry) => entry.id)).toEqual(["archived-mine"]);
  });
});
