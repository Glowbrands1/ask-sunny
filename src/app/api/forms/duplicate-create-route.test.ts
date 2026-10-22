import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * ============================================================================
 * POST /api/forms/instances — ONE FORM PER CHAT CARD
 * ============================================================================
 *
 * QA, 22 Oct 2026: the same card created twice (a lost response retried, a
 * second tab, a reopened conversation) filed two Corrective Action Forms.
 * These drive the REAL route and the REAL `createInstance` against the
 * in-memory store, with the body `createInlineForm` sends, and count rows.
 *
 * WHAT THE FAKE CAN AND CANNOT PROVE. It runs each query atomically and
 * interleaves only at `await`s, so "concurrent" here means requests whose
 * awaits interleave in one process — the shape of a double submission
 * reaching one server instance. Two server instances are modelled by loading
 * the route twice (two separate in-process locks) over one store. The claim
 * table's primary key is modelled as a 23505 on a repeated (manager, card)
 * insert; that it really is the table's primary key is asserted against the
 * migration's SQL below. Real Postgres locking under real parallel
 * connections is not exercised here.
 *
 * Synthetic people only.
 */

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
};

const state = vi.hoisted(() => ({ subject: "manager-1" }));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

vi.mock("@/lib/auth/server", async () => ({
  authorizeRequest: async (_request: Request, permission: string) => ({
    identity: {
      subject: state.subject,
      email: `${state.subject}@example.com`,
      displayName: "Manager",
      role: "admin",
      scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
      verified: true,
    },
    permission,
    provider: "supabase",
  }),
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");

/** A fresh copy of the route and everything under it: a second server instance. */
async function serverInstance() {
  vi.resetModules();
  return import("./instances/route");
}

function joinOverview() {
  for (const row of store.form_instances) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? "2026-10-22",
      template_key: template?.key,
      template_name: template?.name,
      layout_family: template?.layout_family,
      template_version: version?.version,
    });
  }
}

const CARD = "6ba45454-5227-422c-ad84-4e480717f22e";

function body(overrides: Record<string, unknown> = {}) {
  return {
    templateKey: "dpoa",
    employeeName: "Tess Varga",
    variantKey: null,
    employeeRole: null,
    locationId: null,
    source: "ask_sunny",
    proposalId: CARD,
    warningLevel: "verbal",
    payrollDeduct: "no",
    ...overrides,
  };
}

async function create(route: { POST: (request: Request) => Promise<Response> }, payload = body()) {
  const response = await route.POST(
    new Request("https://app.test/api/forms/instances", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  joinOverview();
  return {
    status: response.status,
    json: (await response.json()) as { instance?: { id: string }; reused?: boolean; code?: string },
  };
}

const createdEvents = () => store.form_instance_events.filter((event) => event.kind === "created");

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  delete store.form_create_claims;
  state.subject = "manager-1";
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the same card created twice files one form", () => {
  it("a retry after the first create finished gets the same form back, marked reused", async () => {
    const route = await serverInstance();
    const first = await create(route);
    const second = await create(route);

    expect(first.status).toBe(200);
    expect(first.json.reused).toBeUndefined();
    expect(second.status).toBe(200);
    expect(second.json.reused).toBe(true);
    expect(second.json.instance!.id).toBe(first.json.instance!.id);
    expect(store.form_instances).toHaveLength(1);
    expect(createdEvents()).toHaveLength(1);
    expect(createdEvents()[0]!.detail).toMatchObject({ proposalId: CARD });
    // The stated answers were written once, by the first create only.
    expect(store.form_instance_events.filter((event) => event.kind === "drafted")).toHaveLength(2);
  });

  it("three simultaneous presses on one server instance file one form", async () => {
    const route = await serverInstance();
    const results = await Promise.all([create(route), create(route), create(route)]);

    expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map((result) => result.json.instance!.id)).size).toBe(1);
    expect(results.filter((result) => result.json.reused)).toHaveLength(2);
    expect(store.form_instances).toHaveLength(1);
  });

  it("with the claim table, simultaneous presses on two server instances file one form", async () => {
    store.form_create_claims = [];
    const a = await serverInstance();
    const b = await serverInstance();
    const results = await Promise.all([create(a), create(b)]);

    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(new Set(results.map((result) => result.json.instance!.id)).size).toBe(1);
    expect(store.form_instances).toHaveLength(1);
    expect(store.form_create_claims).toHaveLength(1);
    expect(store.form_create_claims[0]!.instance_id).toBe(results[0]!.json.instance!.id);
  });

  /*
   * NO MIGRATION NEEDED (QA, 22 Oct 2026, round 3): without the claim table,
   * two server instances that receive the same card at the same moment both
   * pass the lookup — and both insert the card's own row id
   * (`cardInstanceId`), so the primary key lets one through and the other
   * hands back the winner's form.
   */
  it("without the claim table, simultaneous presses on two server instances still file one form", async () => {
    const a = await serverInstance();
    const b = await serverInstance();
    const results = await Promise.all([create(a), create(b)]);

    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(new Set(results.map((result) => result.json.instance!.id)).size).toBe(1);
    expect(results.filter((result) => result.json.reused)).toHaveLength(1);
    expect(store.form_instances).toHaveLength(1);
  });

  it("without the claim table, five presses across three server instances file one form", async () => {
    const servers = [await serverInstance(), await serverInstance(), await serverInstance()];
    const results = await Promise.all([0, 1, 2, 0, 1].map((index) => create(servers[index]!)));

    expect(new Set(results.map((result) => result.json.instance!.id)).size).toBe(1);
    expect(store.form_instances).toHaveLength(1);
  });

  it("without the claim table, a card reopened past the lookup window still finds its form", async () => {
    const first = await create(await serverInstance());
    for (const row of store.form_instances) row.created_at = "2026-10-01T00:00:00.000Z";
    const later = await create(await serverInstance());

    expect(later.json.reused).toBe(true);
    expect(later.json.instance!.id).toBe(first.json.instance!.id);
    expect(store.form_instances).toHaveLength(1);
  });

  it("a press after the conversation is reopened — a new request, minutes later — reuses the form", async () => {
    const first = await create(await serverInstance());
    // Reopened: a new page load, so a new copy of everything in the browser and on the server.
    const later = await create(await serverInstance(), body({ conversation: [] }));

    expect(later.json.reused).toBe(true);
    expect(later.json.instance!.id).toBe(first.json.instance!.id);
    expect(store.form_instances).toHaveLength(1);
  });

  it("with the claim table, a reopened card past the lookup window still finds its form", async () => {
    store.form_create_claims = [];
    const first = await create(await serverInstance());
    // Two days on: outside the lookup window, so only the claim knows.
    for (const row of store.form_instances) row.created_at = "2026-10-01T00:00:00.000Z";
    const later = await create(await serverInstance());

    expect(later.json.reused).toBe(true);
    expect(later.json.instance!.id).toBe(first.json.instance!.id);
    expect(store.form_instances).toHaveLength(1);
  });
});

describe("what is never merged", () => {
  it("a new card for the same employee is a new form", async () => {
    const route = await serverInstance();
    const first = await create(route);
    const second = await create(route, body({ proposalId: "9f1c2b7e-0000-4000-8000-000000000002" }));

    expect(second.json.reused).toBeUndefined();
    expect(second.json.instance!.id).not.toBe(first.json.instance!.id);
    expect(store.form_instances).toHaveLength(2);
  });

  it.each([
    ["without the claim table", false],
    ["with the claim table", true],
  ])("a finalized form is never handed back for editing (%s)", async (_label, claims) => {
    if (claims) store.form_create_claims = [];
    const route = await serverInstance();
    const first = await create(route);
    const row = store.form_instances.find((entry) => entry.id === first.json.instance!.id)!;
    Object.assign(row, { status: "finalized", finalized_at: new Date().toISOString() });

    const second = await create(route);
    expect(second.json.reused).toBeUndefined();
    expect(second.json.instance!.id).not.toBe(first.json.instance!.id);
    expect(store.form_instances).toHaveLength(2);
    if (claims) expect(store.form_create_claims![0]!.instance_id).toBe(second.json.instance!.id);
  });

  it("another manager pressing a card with the same id gets their own form", async () => {
    store.form_create_claims = [];
    const route = await serverInstance();
    const mine = await create(route);
    state.subject = "manager-2";
    const theirs = await create(route);

    expect(theirs.json.reused).toBeUndefined();
    expect(theirs.json.instance!.id).not.toBe(mine.json.instance!.id);
    expect(store.form_instances).toHaveLength(2);
  });

  it("a different employee on the same card id is not handed the first form", async () => {
    const route = await serverInstance();
    const first = await create(route);
    const other = await create(route, body({ employeeName: "Remy Calder" }));
    expect(other.json.instance!.id).not.toBe(first.json.instance!.id);
  });

  it("a create with no card id (the manual path) always creates", async () => {
    const route = await serverInstance();
    await create(route, body({ source: "manual", proposalId: undefined }));
    await create(route, body({ source: "manual", proposalId: undefined }));
    expect(store.form_instances).toHaveLength(2);
  });

  it("an id that is not a card id is ignored, not matched", async () => {
    const route = await serverInstance();
    await create(route, body({ proposalId: "'; drop table form_instances; --" }));
    await create(route, body({ proposalId: "'; drop table form_instances; --" }));
    expect(store.form_instances).toHaveLength(2);
  });
});

describe("a claim whose request did not finish", () => {
  it("is taken over once it is stale, and the form is created", async () => {
    store.form_create_claims = [
      { created_by: "manager-1", proposal_id: CARD, instance_id: null, claimed_at: "2026-10-22T00:00:00.000Z" },
    ];
    const result = await create(await serverInstance());
    expect(result.status).toBe(200);
    expect(store.form_instances).toHaveLength(1);
    expect(store.form_create_claims[0]!.instance_id).toBe(result.json.instance!.id);
  });

  it("while it is fresh, the press is told to try again and nothing is written", async () => {
    store.form_create_claims = [
      { created_by: "manager-1", proposal_id: CARD, instance_id: null, claimed_at: new Date().toISOString() },
    ];
    const result = await create(await serverInstance());
    expect(result.status).toBe(409);
    expect(result.json.code).toBe("create_in_progress");
    expect(store.form_instances).toHaveLength(0);
  }, 10_000);
});

describe("the claim table's guarantee is the migration's primary key", () => {
  it("declares (created_by, proposal_id) as the primary key, server-only", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261022001000_form_create_claims.sql", "utf8");
    expect(sql).toMatch(/create table if not exists public\.form_create_claims/);
    expect(sql).toMatch(/primary key \(created_by, proposal_id\)/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/force row level security/);
    expect(sql).toMatch(/revoke all on public\.form_create_claims from anon, authenticated/);
  });
});

describe("the browser does not draft a form the server handed back", () => {
  it("returns reused and makes no drafting call", async () => {
    const { createInlineForm } = await import("@/features/chat/create-inline-form");
    const calls: string[] = [];
    const call = (async (url: string) => {
      calls.push(url);
      return { instance: { id: "inst-existing" }, reused: true };
    }) as never;
    const result = await createInlineForm({
      proposal: {
        proposalId: CARD,
        templateKey: "dpoa",
        templateName: "Corrective Action Form",
        employeeName: "Tess Varga",
        sourceMessageIds: ["m1"],
      } as never,
      messages: [{ id: "m1", role: "user", content: "create a verbal CA for tess varga for missing the woven deadline" }],
      call,
      onCreated: () => {},
    });
    expect(result.reused).toBe(true);
    expect(result.reference.instanceId).toBe("inst-existing");
    expect(calls).toEqual(["/api/forms/instances"]);
  });
});
