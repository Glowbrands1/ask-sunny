import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTIVITY_SURFACES,
  ACTIVITY_TURN_KINDS,
  SURFACE_FOR_REPORT_FAMILY,
  SURFACE_LABEL,
  type ActivitySurface,
} from "./taxonomy";
import {
  FEEDBACK_OUTCOMES,
  FEEDBACK_STATUSES,
  COMMENT_MAX_LENGTH,
} from "@/lib/feedback/types";

/**
 * THE FEEDBACK SCHEMA, AND THE PROMISES AROUND IT.
 *
 * Static checks over the migration text and the source, in the same spirit as
 * the reporting-schema suite. They are not a substitute for applying the
 * migration — they catch the regressions that would otherwise only surface
 * against a live project, which is the expensive way to find them.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

function migration(fragment: string): string {
  const name = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .find((file) => file.includes(fragment));
  if (!name) throw new Error(`No migration matching "${fragment}"`);
  return readFileSync(join(MIGRATIONS, name), "utf8");
}

/**
 * Statements with the prose removed, so a comment can neither satisfy nor fail
 * a check.
 *
 * BOTH COMMENT FORMS, and the block form is the one that matters here: these
 * migrations EXPLAIN the guarantees they must not break — "there is nowhere to
 * put a question, a prompt or an answer" — in `/* *\/` blocks between the
 * column definitions. Stripping only `--` lines would leave that sentence in
 * the text and fail the very assertion it documents, which is this project's
 * standing reason for the rule.
 */
function statementsOnly(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ");
}

/** The members of a `create type ... as enum (...)` block, in order. */
function enumMembers(sql: string, typeName: string): string[] {
  const pattern = new RegExp(
    `create type public\\.${typeName} as enum \\(([^)]*)\\)`,
    "i",
  );
  const found = statementsOnly(sql).match(pattern);
  if (!found) throw new Error(`No enum ${typeName} in that migration`);
  return [...found[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

const FEEDBACK_SQL = migration("ask_sunny_feedback.sql");
const READS_SQL = migration("ask_sunny_feedback_reads");

/* ------------------------------------------------- the enums match the app -- */

describe("the TypeScript vocabularies mirror the database enums", () => {
  /*
   * A MEMBER ADDED ON ONE SIDE ONLY IS A FAILED INSERT, not a miscount — the
   * database refuses an unknown enum value. These tests are what make that a
   * build failure instead of a production one.
   */
  it("ships the same surfaces", () => {
    expect(enumMembers(FEEDBACK_SQL, "activity_surface")).toEqual([
      ...ACTIVITY_SURFACES,
    ]);
  });

  it("ships the same turn kinds", () => {
    expect(enumMembers(FEEDBACK_SQL, "activity_turn_kind")).toEqual([
      ...ACTIVITY_TURN_KINDS,
    ]);
  });

  it("ships the same moderation statuses", () => {
    expect(enumMembers(FEEDBACK_SQL, "feedback_status")).toEqual([
      ...FEEDBACK_STATUSES,
    ]);
  });

  it("ships the same got-what-needed outcomes", () => {
    expect(enumMembers(FEEDBACK_SQL, "feedback_outcome")).toEqual([
      ...FEEDBACK_OUTCOMES,
    ]);
  });

  it("gives every surface a label", () => {
    /* `Record<Union, string>` proves completeness at compile time; this proves
       none of them is blank, which the type cannot. */
    for (const surface of ACTIVITY_SURFACES) {
      expect(SURFACE_LABEL[surface]?.trim().length, surface).toBeGreaterThan(0);
    }
  });

  it("maps every report family to a real surface", () => {
    const mapped = Object.values(SURFACE_FOR_REPORT_FAMILY) as ActivitySurface[];
    expect(mapped.length).toBe(5);
    for (const surface of mapped) {
      expect(ACTIVITY_SURFACES).toContain(surface);
    }
    /* Five families, five distinct surfaces — never two sharing one. */
    expect(new Set(mapped).size).toBe(5);
  });
});

/* -------------------------------------------------------- the table shape -- */

describe("the feedback table", () => {
  const sql = statementsOnly(FEEDBACK_SQL);

  it("keys feedback to a server-recorded turn, not to a browser id", () => {
    /*
     * THE WHOLE AUTHORIZATION MODEL RESTS ON THIS. A rating keyed to the
     * conversation or message id would be keyed to a value the browser minted
     * and could mint again, so "is this your answer to rate?" would have no
     * answer.
     */
    expect(sql).toContain("activity_event_id uuid not null");
    expect(sql).toContain("references public.activity_events (id)");
  });

  it("allows one rating per person per answer", () => {
    /* Without it a double-click is two rows and the average moves twice. */
    expect(sql).toContain("unique (activity_event_id, user_id)");
  });

  it("bounds the rating to the scale the UI offers", () => {
    expect(sql).toContain("rating between 1 and 5");
  });

  it("requires a non-empty comment, bounded to the same length the app uses", () => {
    expect(sql).toContain("length(btrim(comment)) > 0");
    expect(sql).toContain(`length(comment) <= ${COMMENT_MAX_LENGTH}`);
  });

  it("keeps a hidden comment rather than deleting it", () => {
    /*
     * Hiding must not be able to make it as though nobody complained — which is
     * what a DELETE would do, and what makes "we had no complaints about that
     * release" a sentence nobody can check.
     */
    expect(sql).toContain("hidden_at timestamptz");
    expect(sql).toContain("hidden_by uuid");
    expect(sql).not.toMatch(/delete from public\.ask_sunny_feedback/i);
  });

  it("keeps the feedback when the person is deleted", () => {
    /* The attribution is what is lost; the finding survives. */
    expect(sql).toMatch(
      /user_id uuid references auth\.users \(id\) on delete set null/,
    );
  });

  it("is closed to the browser-held roles with no policy defined", () => {
    /*
     * The posture of every table in this schema: RLS enabled and forced with no
     * policy, which denies every role that does not bypass it, and the default
     * grants revoked because Supabase hands `anon` and `authenticated` full DML
     * on any new table in `public`.
     */
    expect(sql).toContain("alter table public.ask_sunny_feedback enable row level security");
    expect(sql).toContain("alter table public.ask_sunny_feedback force row level security");
    expect(sql).toContain("revoke all on public.ask_sunny_feedback from anon, authenticated");
    expect(sql).not.toMatch(/create policy[\s\S]*ask_sunny_feedback/i);
  });

  it("revokes the trigger function from all three roles", () => {
    /*
     * Postgres grants EXECUTE to PUBLIC on creation, and a Supabase project
     * ALSO grants it to `anon` and `authenticated` directly — so revoking
     * `public` alone leaves the door open. All three, every time.
     */
    expect(sql).toContain(
      "revoke all on function public.ask_sunny_feedback_touch() from public, anon, authenticated",
    );
  });

  it("adds the two event columns without a default that would invent history", () => {
    /*
     * Every event written before this migration happened on a surface nobody
     * recorded. Defaulting them would file the Overview band's and five report
     * bars' history under whichever surface was convenient, and the first
     * "where is Ask Sunny used?" chart would be confidently wrong.
     */
    expect(sql).toContain("add column if not exists surface public.activity_surface");
    expect(sql).toContain("add column if not exists turn_kind public.activity_turn_kind");
    expect(sql).not.toMatch(/add column if not exists surface[^;]*default/i);
    expect(sql).not.toMatch(/add column if not exists turn_kind[^;]*default/i);
  });

  it("still has nowhere to put a question", () => {
    /*
     * The feedback table stores a COMMENT — words somebody typed into a box
     * knowing an administrator would read them. It must never grow a column for
     * the question or the answer, which are the HR content the whole event
     * model refuses to hold.
     */
    const columns =
      sql.split("create table if not exists public.ask_sunny_feedback (")[1]?.split(");")[0] ??
      "";
    expect(columns.length).toBeGreaterThan(0);
    for (const forbidden of ["question", "prompt", "answer", "excerpt", "transcript"]) {
      expect(columns, `ask_sunny_feedback declares ${forbidden}`).not.toMatch(
        new RegExp(`\\b${forbidden}\\b`),
      );
    }
  });
});

/* ------------------------------------------------------- the read functions */

describe("the feedback read functions", () => {
  const sql = statementsOnly(READS_SQL);

  it("excludes hidden feedback from every average and distribution", () => {
    /*
     * The property that makes hiding a moderation action rather than a
     * deletion: the average stops counting it the moment it is hidden.
     */
    const summary =
      sql.split("create or replace function public.analytics_feedback_summary")[1]?.split("$$;")[1] ??
      "";
    expect(sql).toContain("avg(f.rating) filter (where f.hidden_at is null)");
    expect(sql).toContain("count(*) filter (where f.hidden_at is null)");
    expect(summary).toBeDefined();
  });

  it("keeps hidden items in the moderation queue counts", () => {
    /* Hiding a complaint is not the same as answering it. */
    expect(sql).toContain("count(*) filter (where f.status = 'pending')");
    expect(sql).toContain("count(*) filter (where f.hidden_at is not null) as hidden");
  });

  it("hides hidden feedback from the list unless it is asked for", () => {
    expect(sql).toContain("p_include_hidden boolean default false");
    expect(sql).toContain("(p_include_hidden or f.hidden_at is null)");
  });

  it("escapes the wildcards in a search term", () => {
    /* A search for "100%" is a search for "100%", not for everything. */
    expect(sql).toContain("replace(replace(replace(btrim(p_search)");
  });

  it("bounds the page size whatever the caller asks for", () => {
    expect(sql).toContain("limit greatest(1, least(coalesce(p_limit, 25), 200))");
    expect(sql).toContain("offset greatest(0, coalesce(p_offset, 0))");
  });

  it("leaves acknowledgements out of the topic counts and reports them separately", () => {
    expect(sql).toContain(
      "count(*) filter (where a.turn_kind is distinct from 'acknowledgement') as events",
    );
    expect(sql).toContain(
      "count(*) filter (where a.turn_kind = 'acknowledgement') as acknowledgements",
    );
  });

  it("counts a turn whose kind was never assessed as a question", () => {
    /*
     * `is distinct from` rather than `<>`, which is the whole point: rows
     * recorded before the column shipped carry a null, and `null <>
     * 'acknowledgement'` is null — so `<>` would silently drop every one of
     * them and shrink history.
     */
    expect(sql).not.toMatch(/turn_kind <> 'acknowledgement'/);
  });

  it("returns no accuracy rating it does not have", () => {
    /*
     * Nothing in this product asks a person to grade an extraction. A success
     * rate is a liveness measure, not an accuracy one — a parse can succeed and
     * still read the wrong column.
     */
    const extraction =
      sql.split("create or replace function public.analytics_extraction_runs")[1]?.split("$$;")[0] ??
      "";
    expect(extraction.length).toBeGreaterThan(0);
    expect(extraction).not.toMatch(/\brating\b/i);
    expect(extraction).not.toMatch(/\baccuracy\b/i);
  });

  it("takes the timezone as an argument rather than hard-coding a second one", () => {
    /*
     * `business-date.ts` is this product's one answer to "what time is it where
     * the salons are". A copy inside a function would be two parts of one
     * product disagreeing about it, each internally consistent — which is what
     * makes that failure so hard to see.
     */
    expect(sql).toContain("p_timezone text default 'America/New_York'");
    expect(sql).toContain("from pg_timezone_names where name = p_timezone");
  });

  it("pins search_path on every function it defines", () => {
    /*
     * An unpinned function resolves names against whatever the caller's path
     * happens to be, which is how a trojan table in another schema gets read.
     */
    const definitions = sql.match(/create or replace function public\.\w+/g) ?? [];
    expect(definitions.length).toBeGreaterThanOrEqual(7);
    expect(
      (sql.match(/set search_path = public, extensions/g) ?? []).length,
    ).toBeGreaterThanOrEqual(definitions.length);
  });

  it("revokes execute from public, anon and authenticated on every function", () => {
    const definitions = (sql.match(/create or replace function public\.(\w+)/g) ?? []).map(
      (line) => line.replace("create or replace function public.", ""),
    );
    for (const name of definitions) {
      expect(sql, `${name} is not revoked`).toContain(
        `revoke all on function public.${name}(`,
      );
    }
    const revokes = sql.match(/revoke all on function public\.\w+\([^)]*\) from ([^;]+);/g) ?? [];
    expect(revokes.length).toBe(definitions.length);
    for (const revoke of revokes) {
      expect(revoke).toContain("from public, anon, authenticated");
    }
  });
});
