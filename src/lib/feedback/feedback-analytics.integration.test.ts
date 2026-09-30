import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createMigratedTestDatabase,
  type KnowledgeTestDatabase,
} from "@/test/pglite-knowledge-db";
import type { AccessScope, Role } from "@/types";

/**
 * =============================================================================
 * A RATING SUBMITTED IN CHAT IS THE ROW THE ANALYTICS DASHBOARD READS
 * =============================================================================
 *
 * The chain this protects, end to end and with nothing reimplemented:
 *
 *   `openTurn` / `closeTurn`          what `/api/chat` records for an answer
 *   `saveFeedback`                    what `/api/chat/feedback` writes
 *   `ownFeedbackForTurns`             what a reopened conversation reads back
 *   `moderateFeedback`                what the Feedback tab does to the queue
 *   `loadFeedbackAnalytics`           Admin → Analytics → Conversation Feedback
 *   `loadFeedbackPage`                the Feedback tab's list
 *
 * — every one of them the application's own function, calling the
 * repository's own SQL (`analytics_feedback_summary`, `analytics_feedback_list`,
 * `analytics_surfaces`, `feedback_attributed`, `leader_directory`, the
 * one-per-person-per-answer unique key) on a real Postgres (PGlite), with the
 * migrations applied verbatim. Only Supabase's platform objects are stood in.
 *
 * WHY IT EXISTS: fixing the star control must not change where a rating goes.
 * There is one feedback table and one analytics pipeline, and a rating left by
 * an Admin, a Regional Manager, a District Manager, a Salon Director or an
 * Employee must reach the same dashboard with its role, salon, surface and
 * topic intact.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const ALL_MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => file.replace(/\.sql$/, ""));

/**
 * THE LAST MIGRATION THAT SHAPES FEEDBACK OR ITS ANALYTICS. Everything up to
 * and including it is applied, in order. The guard test below fails if a later
 * migration redefines any of these objects, so this cannot silently go stale.
 */
const LAST_FEEDBACK_MIGRATION = "20260917001000_feedback_optional_words";
const APPLIED = ALL_MIGRATIONS.slice(0, ALL_MIGRATIONS.indexOf(LAST_FEEDBACK_MIGRATION) + 1);

/** Supabase platform objects the earlier migrations reach for. */
const PLATFORM = `
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
`;

let harness: KnowledgeTestDatabase;

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => harness.client,
}));

/* The turn recorder's telemetry is a log line; it is not what is under test. */
vi.mock("@/lib/analytics/telemetry", () => ({
  logTurnEvent: () => {},
}));

/* ------------------------------------------------------------- people -- */

interface Person {
  id: string;
  role: Role;
  name: string;
  scope: AccessScope;
}

const SALON_0306 = "0306";
const SALON_0144 = "0144";

const PEOPLE = {
  admin: {
    id: "a0000000-0000-4000-8000-000000000001",
    role: "admin",
    name: "Test Admin",
    scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
  },
  rm: {
    id: "a0000000-0000-4000-8000-000000000002",
    role: "regional_manager",
    name: "Test Regional Manager",
    scope: { level: "salon", primaryAreaId: `loc-${SALON_0144}`, alsoCoversAreaIds: [] },
  },
  dm: {
    id: "a0000000-0000-4000-8000-000000000003",
    role: "district_manager",
    name: "Test District Manager",
    scope: { level: "salon", primaryAreaId: `loc-${SALON_0306}`, alsoCoversAreaIds: [] },
  },
  sd: {
    id: "a0000000-0000-4000-8000-000000000004",
    role: "salon_director",
    name: "Test Salon Director",
    scope: { level: "salon", primaryAreaId: `loc-${SALON_0306}`, alsoCoversAreaIds: [] },
  },
  employee: {
    id: "a0000000-0000-4000-8000-000000000005",
    role: "employee",
    name: "Test Employee",
    scope: { level: "salon", primaryAreaId: `loc-${SALON_0144}`, alsoCoversAreaIds: [] },
  },
} satisfies Record<string, Person>;

/* Loaded after the mocks, so they bind to the harness. */
let record: typeof import("@/lib/analytics/record");
let store: typeof import("@/lib/feedback/store");
let queries: typeof import("@/lib/analytics/feedback-queries");
let filters: typeof import("@/lib/analytics/filters");
let feedbackFilters: typeof import("@/lib/analytics/feedback-filters");

/** Each person's answered turn, recorded the way `/api/chat` records it. */
const turns: Record<keyof typeof PEOPLE, string> = {} as never;

beforeAll(async () => {
  harness = await createMigratedTestDatabase(APPLIED, { platform: PLATFORM });

  await harness.db.exec(`
    insert into public.salons (salon_number, store_name) values
      ('${SALON_0306}', 'KS Manhattan'),
      ('${SALON_0144}', 'NE Lincoln');
  `);
  for (const person of Object.values(PEOPLE)) {
    await harness.db.query(`insert into auth.users (id) values ($1)`, [person.id]);
    await harness.db.query(
      `insert into public.app_users (id, email, display_name, role, status, scope_level, scope_primary_area_id)
       values ($1, $2, $3, $4, 'active', $5, $6)`,
      [
        person.id,
        `${person.role}@example.test`,
        person.name,
        person.role,
        person.scope.level,
        person.scope.primaryAreaId,
      ],
    );
  }

  record = await import("@/lib/analytics/record");
  store = await import("@/lib/feedback/store");
  queries = await import("@/lib/analytics/feedback-queries");
  filters = await import("@/lib/analytics/filters");
  feedbackFilters = await import("@/lib/analytics/feedback-filters");

  for (const [key, person] of Object.entries(PEOPLE) as [keyof typeof PEOPLE, Person][]) {
    const turnId = await record.openTurn({
      feature: "chat",
      category: "general_guidance",
      turnKind: "question",
      surface: "main_chat",
      actorId: person.id,
      actorRole: person.role,
      scope: person.scope,
    });
    await record.closeTurn(turnId, {
      category: "policy_question",
      succeeded: true,
      latencyMs: 1200,
    });
    turns[key] = turnId;
  }
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

async function feedbackRows(turnId: string) {
  return (
    await harness.db.query<{ id: string; rating: number; user_id: string }>(
      `select id, rating, user_id from public.ask_sunny_feedback where activity_event_id = $1`,
      [turnId],
    )
  ).rows;
}

/* ============================================================= saving === */

describe("every role's rating is saved against its own turn", () => {
  it("rating only — an Admin", async () => {
    const saved = await store.saveFeedback({
      turnId: turns.admin,
      userId: PEOPLE.admin.id,
      rating: 5,
      gotWhatNeeded: null,
      comment: "",
    });
    expect(saved).toMatchObject({ turnId: turns.admin, rating: 5, gotWhatNeeded: null, comment: "" });
  });

  it("rating and outcome — a Regional Manager", async () => {
    const saved = await store.saveFeedback({
      turnId: turns.rm,
      userId: PEOPLE.rm.id,
      rating: 4,
      gotWhatNeeded: "yes",
      comment: "",
    });
    expect(saved).toMatchObject({ rating: 4, gotWhatNeeded: "yes", comment: "" });
  });

  it("rating, outcome and comment — a District Manager", async () => {
    const saved = await store.saveFeedback({
      turnId: turns.dm,
      userId: PEOPLE.dm.id,
      rating: 2,
      gotWhatNeeded: "partially",
      comment: "Missed the attendance policy.",
      clientConversationId: "conv_smoketest01",
      clientMessageId: "msg_smoketest01",
    });
    expect(saved).toMatchObject({
      rating: 2,
      gotWhatNeeded: "partially",
      comment: "Missed the attendance policy.",
    });
  });

  it("a Salon Director and an Employee, who hold ask_questions too", async () => {
    await store.saveFeedback({
      turnId: turns.sd,
      userId: PEOPLE.sd.id,
      rating: 3,
      gotWhatNeeded: "no",
      comment: "",
    });
    await store.saveFeedback({
      turnId: turns.employee,
      userId: PEOPLE.employee.id,
      rating: 1,
      gotWhatNeeded: "no",
      comment: "Wrong salon entirely.",
    });
    expect(await feedbackRows(turns.sd)).toHaveLength(1);
    expect(await feedbackRows(turns.employee)).toHaveLength(1);
  });

  it("refuses anyone — an Admin included — rating somebody else's turn, and writes nothing", async () => {
    await expect(
      store.saveFeedback({
        turnId: turns.dm,
        userId: PEOPLE.admin.id,
        rating: 1,
        gotWhatNeeded: null,
        comment: "",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const rows = await feedbackRows(turns.dm);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe(PEOPLE.dm.id);
  });

  it("an edit updates the one existing row instead of adding a second rating", async () => {
    const [before] = await feedbackRows(turns.dm);

    const edited = await store.saveFeedback({
      turnId: turns.dm,
      userId: PEOPLE.dm.id,
      rating: 3,
      gotWhatNeeded: "partially",
      comment: "Missed the attendance policy.",
    });

    const after = await feedbackRows(turns.dm);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before!.id);
    expect(after[0]!.rating).toBe(3);
    expect(edited.id).toBe(before!.id);
  });

  it("reads the saved rating back for the person who left it, and for nobody else", async () => {
    const own = await store.ownFeedbackForTurns(PEOPLE.dm.id, [turns.dm, turns.admin]);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ turnId: turns.dm, rating: 3, gotWhatNeeded: "partially" });

    expect(await store.ownFeedbackForTurns(PEOPLE.admin.id, [turns.dm])).toEqual([]);
  });
});

/* ========================================================== analytics === */

describe("Admin → Analytics → Conversation Feedback sees every submitted rating", () => {
  it("counts them in the average, the distribution, the outcome split and the queue", async () => {
    const snapshot = await queries.loadFeedbackAnalytics(filters.EMPTY_FILTERS);

    /* admin 5 · rm 4 · dm 3 (edited from 2) · sd 3 · employee 1 */
    expect(snapshot.summary.responses).toBe(5);
    expect(snapshot.summary.averageRating).toBe(3.2);
    expect(snapshot.summary.distribution).toEqual({ 1: 1, 2: 0, 3: 2, 4: 1, 5: 1 });
    expect(snapshot.summary.outcomes).toEqual({ yes: 1, partially: 1, no: 2 });
    expect(snapshot.summary.queue).toEqual({ pending: 5, in_review: 0, resolved: 0, dismissed: 0 });

    const chat = snapshot.surfaces.find((row) => row.surface === "main_chat");
    expect(chat).toMatchObject({ events: 5, rated: 5, averageRating: 3.2 });
  });

  it("lists each with its person, role, salon, surface, topic, comment and time", async () => {
    const page = await queries.loadFeedbackPage(
      filters.EMPTY_FILTERS,
      feedbackFilters.EMPTY_FEEDBACK_FILTERS,
    );
    expect(page.total).toBe(5);

    const byTurn = new Map(page.items.map((item) => [item.turnId, item]));

    expect(byTurn.get(turns.admin)).toMatchObject({
      rating: 5,
      role: "admin",
      displayName: "Test Admin",
      storeName: null,
      surface: "main_chat",
      category: "policy_question",
      status: "pending",
    });
    expect(byTurn.get(turns.rm)).toMatchObject({
      rating: 4,
      gotWhatNeeded: "yes",
      role: "regional_manager",
      displayName: "Test Regional Manager",
      storeName: "NE Lincoln",
    });
    expect(byTurn.get(turns.dm)).toMatchObject({
      rating: 3,
      gotWhatNeeded: "partially",
      comment: "Missed the attendance policy.",
      role: "district_manager",
      displayName: "Test District Manager",
      storeName: "KS Manhattan",
      surface: "main_chat",
      category: "policy_question",
      succeeded: true,
    });
    expect(byTurn.get(turns.sd)).toMatchObject({ role: "salon_director", storeName: "KS Manhattan" });
    expect(byTurn.get(turns.employee)).toMatchObject({
      role: "employee",
      storeName: "NE Lincoln",
      comment: "Wrong salon entirely.",
    });

    for (const item of page.items) {
      expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
      expect(Number.isNaN(Date.parse(item.occurredAt))).toBe(false);
    }
  });

  it("filters by role, so a District Manager's rating is attributed to District Managers", async () => {
    const page = await queries.loadFeedbackPage(
      { ...filters.EMPTY_FILTERS, role: "district_manager" },
      feedbackFilters.EMPTY_FEEDBACK_FILTERS,
    );
    expect(page.items.map((item) => item.turnId)).toEqual([turns.dm]);
  });

  it("moves between pending, in review, resolved and dismissed as the queue is worked", async () => {
    const page = await queries.loadFeedbackPage(
      filters.EMPTY_FILTERS,
      feedbackFilters.EMPTY_FEEDBACK_FILTERS,
    );
    const id = (turn: string) => page.items.find((item) => item.turnId === turn)!.id;

    await store.moderateFeedback({ feedbackId: id(turns.rm), adminUserId: PEOPLE.admin.id, status: "in_review" });
    await store.moderateFeedback({ feedbackId: id(turns.sd), adminUserId: PEOPLE.admin.id, status: "resolved" });
    await store.moderateFeedback({ feedbackId: id(turns.employee), adminUserId: PEOPLE.admin.id, status: "dismissed" });

    const snapshot = await queries.loadFeedbackAnalytics(filters.EMPTY_FILTERS);
    expect(snapshot.summary.queue).toEqual({ pending: 2, in_review: 1, resolved: 1, dismissed: 1 });

    /*
     * The ratings count OPEN feedback only (see
     * `ratings_count_open_feedback_only`): admin 5, rm 4, dm 3 remain.
     */
    expect(snapshot.summary.responses).toBe(3);
    expect(snapshot.summary.averageRating).toBe(4);
  });
});

/* ============================================================ staleness === */

describe("this suite applies every migration that shapes feedback analytics", () => {
  it("has no later migration redefining a feedback or analytics object", () => {
    const later = ALL_MIGRATIONS.slice(ALL_MIGRATIONS.indexOf(LAST_FEEDBACK_MIGRATION) + 1);
    const redefines =
      /\b(create\s+or\s+replace\s+(function|view)\s+public\.(analytics_\w+|feedback_\w+|leader_directory|salon_directory|activity_attributed|activity_unified)|alter\s+table\s+(if\s+exists\s+)?public\.(ask_sunny_feedback|activity_events)|alter\s+type\s+public\.(activity_\w+|feedback_\w+))\b/i;

    const offenders = later.filter((name) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, `${name}.sql`), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      return redefines.test(sql);
    });

    /* Move LAST_FEEDBACK_MIGRATION forward to include any name listed here. */
    expect(offenders).toEqual([]);
  });
});
