import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * BED USAGE AND SPA REPORTING SCHEMA INVARIANTS.
 *
 * The companion to `reporting-schema.test.ts`, covering the three new report
 * families. STATIC checks over the migration text: they run in `npm test` and
 * catch the regressions that would otherwise only surface against a live
 * project. `supabase/tests/bed_spa_schema_checks.sql` covers what text analysis
 * cannot — whether Postgres actually enforces them — against a throwaway
 * cluster.
 *
 * The invariants here are the ones whose loss would be silent and expensive:
 * a zero-session row becoming storable, a fact table acquiring a salon-total
 * column, a browser-held role keeping a write privilege.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Every table the three new families own. */
const BED_SPA_TABLES = [
  "bed_equipment_levels",
  "spa_equipment_types",
  "bed_usage_snapshots",
  "bed_usage_salon_facts",
  "bed_usage_equipment_facts",
  "bed_usage_chain_benchmarks",
  "spa_wellness_snapshots",
  "spa_wellness_salon_facts",
  "spa_wellness_equipment_facts",
  "spa_equipment_benchmarks",
  "spa_engagement_snapshots",
  "spa_engagement_salon_facts",
  "spa_engagement_manager_facts",
  "spa_bed_inventory",
  "spa_engagement_daily_facts",
] as const;

/** The read surface. Views inherit the same default privileges as tables. */
const BED_SPA_VIEWS = [
  "bed_usage_current_salon_facts",
  "bed_usage_current_equipment_facts",
  "spa_wellness_current_salon_facts",
  "spa_wellness_current_equipment_facts",
  "spa_engagement_current_salon_facts",
  "spa_conversion_current",
] as const;

function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
}

/** Strips `--` comment lines so prose cannot satisfy — or fail — an assertion. */
function statementsOnly(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ");
}

function fileNamed(fragment: string): { name: string; sql: string } {
  const found = migrationFiles().find((file) => file.name.includes(fragment));
  if (!found) throw new Error(`No migration matching "${fragment}"`);
  return found;
}

const ALL = migrationFiles().map((file) => statementsOnly(file.sql)).join(" ");

describe("the new migrations exist and are ordered", () => {
  it("ships every one", () => {
    for (const fragment of [
      "reporting_bed_spa_dimensions",
      "reporting_bed_usage_facts",
      "reporting_spa_wellness_facts",
      "reporting_spa_engagement_facts",
      "reporting_bed_spa_rls",
      "reporting_bed_spa_ingest_functions",
    ]) {
      expect(() => fileNamed(fragment), fragment).not.toThrow();
    }
  });

  it("creates every table before the migration that secures it", () => {
    // A grant on a table that does not exist yet fails at apply time, and a
    // table created after its RLS migration is left wide open.
    const files = migrationFiles();
    const rls = files.findIndex((file) => file.name.includes("reporting_bed_spa_rls"));
    for (const table of BED_SPA_TABLES) {
      const created = files.findIndex((file) =>
        statementsOnly(file.sql).includes(`create table public.${table} (`),
      );
      expect(created, `${table} is never created`).toBeGreaterThanOrEqual(0);
      expect(created, `${table} is created after its RLS migration`).toBeLessThan(rls);
    }
  });

  it("adds the LTM grain before anything casts to it", () => {
    // `alter type ... add value` and a cast to the new value cannot share a
    // transaction, and Supabase runs one transaction per migration file.
    const files = migrationFiles();
    const added = files.findIndex((file) =>
      statementsOnly(file.sql).includes("add value if not exists 'ltm'"),
    );
    const used = files.findIndex((file) =>
      statementsOnly(file.sql).includes("public.report_period_grain") &&
      file.name.includes("bed_spa_ingest_functions"),
    );
    expect(added).toBeGreaterThanOrEqual(0);
    expect(added).toBeLessThan(used);
  });
});

describe("the zero-session rule is in the schema, not only in the parser", () => {
  const sql = statementsOnly(fileNamed("reporting_spa_wellness_facts").sql);

  it("makes a spa equipment session count NOT NULL", () => {
    expect(sql).toContain("sessions numeric(18, 4) not null");
  });

  it("refuses a zero-session row with a check constraint", () => {
    /*
     * THE CENTRAL BUSINESS RULE. A zero in this source means the equipment is
     * NOT INSTALLED. Storing one would let every later `avg()` count an
     * absence as a failure, and 86% of the equipment cells in the August 2026
     * file are blank — so this is a rule about most of the data.
     */
    expect(sql).toContain(
      "constraint spa_wellness_equipment_facts_sessions_positive check (sessions > 0)",
    );
  });

  it("refuses a peer average with no peers behind it", () => {
    // Nobody to compare with is not a comparison of nothing.
    expect(sql).toContain("spa_equipment_benchmarks_empty_peer_has_no_average");
    expect(sql).toContain("peer_salon_count > 0 or peer_average_sessions is null");
  });

  it("keeps the peer benchmark free of any salon reference", () => {
    // A benchmark is an average and a count. A salon_id column here would be
    // another company's data in our database.
    const benchmark = sql.slice(
      sql.indexOf("create table public.spa_equipment_benchmarks ("),
      sql.indexOf("create unique index spa_equipment_benchmarks_live_key"),
    );
    expect(benchmark).not.toContain("salon_id");
    expect(benchmark).not.toContain("store_name");
  });
});

describe("the bed usage grains stay apart", () => {
  const sql = statementsOnly(fileNamed("reporting_bed_usage_facts").sql);

  it("gives the equipment table no salon-total column", () => {
    /*
     * The source repeats `Salon Tans` on every equipment row of a salon —
     * nine to twelve times — so summing the column overstates a salon by an
     * order of magnitude. The equipment table has nowhere to put it, which is
     * what makes the mistake unavailable rather than merely discouraged.
     */
    const equipment = sql.slice(
      sql.indexOf("create table public.bed_usage_equipment_facts ("),
      sql.indexOf("create unique index bed_usage_equipment_facts_live_key"),
    );
    // `share_of_salon_tans` IS present and is a different thing: this row's
    // fraction of its salon's tans. What must not exist is a column holding
    // the salon's total, which is the value the source repeats.
    expect(equipment).not.toMatch(/(^|[ ,(])total_tans numeric/);
    expect(equipment).not.toMatch(/(^|[ ,(])salon_tans numeric/);
    expect(equipment).not.toMatch(/(^|[ ,(])bed_count integer/);
    expect(equipment).toContain("share_of_salon_tans numeric");
  });

  it("keeps the salon total in its own table, one row per salon per period", () => {
    expect(sql).toContain("create table public.bed_usage_salon_facts (");
    expect(sql).toContain(
      "create unique index bed_usage_salon_facts_live_key on public.bed_usage_salon_facts (period_id, salon_id) where superseded_by_ingestion_id is null",
    );
  });

  it("includes the bed MODEL in the equipment key", () => {
    // A salon really does hold two INSTANT models, so a key on (salon, period,
    // level) would reject half its rows.
    expect(sql).toContain(
      "create unique index bed_usage_equipment_facts_live_key on public.bed_usage_equipment_facts (period_id, salon_id, level, bed_type)",
    );
  });

  it("stores v Chain as a percentage AND keeps the source's ratio", () => {
    expect(sql).toContain("v_chain_percent numeric");
    expect(sql).toContain("v_chain_ratio numeric");
  });

  it("stores the equipment level as text rather than a foreign key", () => {
    // A seventh level upstream is a business change; refusing the rows would
    // understate the salon by everything that level carries.
    expect(sql).toContain("level text not null");
    expect(sql).not.toMatch(/level uuid not null references public\.bed_equipment_levels/);
  });
});

describe("the FAST rule reaches the database", () => {
  it("carries an advisory flag on the level vocabulary", () => {
    const sql = statementsOnly(fileNamed("reporting_bed_spa_dimensions").sql);
    expect(sql).toContain("advisory_only boolean not null default false");
    // FAST is the one level flagged, and it is flagged in the seed rather than
    // discovered at read time.
    expect(sql).toMatch(/'FAST', 'Fast', true/);
    expect(sql).toMatch(/'FASTER', 'Faster', false, true/);
  });

  it("exposes the flag on the equipment read view", () => {
    const sql = statementsOnly(fileNamed("reporting_bed_usage_facts").sql);
    expect(sql).toContain("as level_advisory_only");
  });
});

describe("the two engagement metrics cannot be stored under one name", () => {
  const sql = statementsOnly(fileNamed("reporting_spa_engagement_facts").sql);

  it("stores only the four raw counts", () => {
    const facts = sql.slice(
      sql.indexOf("create table public.spa_engagement_salon_facts ("),
      sql.indexOf("create unique index spa_engagement_salon_facts_live_key"),
    );
    for (const column of [
      "spa_sessions numeric",
      "total_unique_tanners numeric",
      "unique_spa_tanners numeric",
      "spa_beds integer",
    ]) {
      expect(facts).toContain(column);
    }
    /*
     * NO STORED RATIO FOR EITHER METRIC. A stored one is a place for the wrong
     * numerator to end up, and cannot be re-aggregated across salons.
     *
     * The `reported_*` columns ARE present and are a different thing: the
     * values the SOURCE published, kept so a printed report can be reconciled
     * against the dashboard without recomputation. The assertions are anchored
     * so `reported_spa_sessions_per_unique_per_bed` does not satisfy them.
     */
    expect(facts).not.toMatch(/(^|[ ,(])spa_per_unique_pct numeric/);
    expect(facts).not.toMatch(/(^|[ ,(])spa_sessions_per_unique_per_bed numeric/);
    expect(facts).not.toMatch(/(^|[ ,(])spa_sessions_per_bed numeric/);
    expect(facts).toContain("reported_spa_sessions_per_unique_per_bed numeric");
  });

  it("computes both in the view, as separately named columns", () => {
    expect(sql).toContain("as spa_per_unique_pct");
    expect(sql).toContain("as spa_sessions_per_unique_per_bed");
    expect(sql).toContain("as spa_sessions_per_bed");
    expect(sql).toContain("as unique_spa_tanner_pct");
  });

  it("guards every ratio against a zero or missing denominator", () => {
    // A salon with no spa beds has no sessions-per-bed figure; a zero would
    // put it at the bottom of a ranking of stores that do have beds.
    expect(sql).toContain("when f.total_unique_tanners > 0 then f.spa_sessions / f.total_unique_tanners");
    expect(sql).toContain("when f.spa_beds > 0 then f.spa_sessions / f.spa_beds");
    expect(sql).toContain(
      "when f.total_unique_tanners > 0 and f.spa_beds > 0 then f.spa_sessions / f.total_unique_tanners / f.spa_beds",
    );
  });

  it("stores the ranking population and weights beside the ranks", () => {
    // A rank without its population is not a rank, and an Overall Rank cannot
    // be re-derived without the weights the delivery carried.
    expect(sql).toContain("rank_population integer not null");
    expect(sql).toContain("rank_weights jsonb not null");
  });

  it("keeps the daily series off the report period", () => {
    // Consecutive deliveries overlap by 27 of 28 days; attaching those rows to
    // the report's period would make them look summable with it.
    const daily = sql.slice(
      sql.indexOf("create table public.spa_engagement_daily_facts ("),
      sql.indexOf("create unique index spa_engagement_daily_facts_live_key"),
    );
    expect(daily).not.toContain("period_id");
    expect(sql).toContain(
      "create unique index spa_engagement_daily_facts_live_key on public.spa_engagement_daily_facts (salon_id, activity_date)",
    );
  });
});

describe("the Spa Conversion view refuses to cross periods", () => {
  const sql = statementsOnly(fileNamed("reporting_spa_engagement_facts").sql);

  it("joins on the period ROW, which carries grain and dates together", () => {
    /*
     * A join on `period_end` alone would pass exactly the comparison that is
     * most wrong: month-to-date through 31 August and year-to-date through
     * 31 August end on the same day and cover eight times the traffic.
     */
    expect(sql).toContain("on spa.period_id = bed.period_id");
    expect(sql).not.toContain("on spa.period_end = bed.period_end");
  });

  it("guards the division against zero traffic", () => {
    expect(sql).toContain("when bed.total_tans > 0 then spa.total_sessions / bed.total_tans");
  });

  it("joins on the canonical salon and the same company", () => {
    expect(sql).toContain("and spa.salon_number = bed.salon_number");
    expect(sql).toContain("and spa.company = bed.company");
  });
});

describe("row level security posture", () => {
  const sql = statementsOnly(fileNamed("reporting_bed_spa_rls").sql);

  it("enables AND forces row level security on every new table", () => {
    for (const table of BED_SPA_TABLES) {
      expect(sql, `${table} enable`).toContain(
        `alter table public.${table} enable row level security;`,
      );
      expect(sql, `${table} force`).toContain(
        `alter table public.${table} force row level security;`,
      );
    }
  });

  it("revokes the browser roles' inherited privileges before granting", () => {
    /*
     * REGRESSION, learned twice in this codebase. Supabase ships
     * `alter default privileges ... grant all on tables to anon, authenticated`,
     * so both roles hold INSERT/UPDATE/DELETE the moment a table is created in
     * `public`, and `grant select` is ADDITIVE.
     */
    for (const relation of [...BED_SPA_TABLES, ...BED_SPA_VIEWS]) {
      expect(sql, `${relation} must be revoked from both roles`).toMatch(
        new RegExp(`revoke all on public\\.${relation}\\s+from anon, authenticated;`),
      );
    }
  });

  it("revokes and grants the views as well as the tables", () => {
    // Default privileges treat a VIEW as a table, and these views join across
    // the whole domain.
    for (const view of BED_SPA_VIEWS) {
      expect(sql, `${view} grant`).toMatch(
        new RegExp(`grant select on public\\.${view}\\s+to authenticated;`),
      );
    }
  });

  it("creates a read-only policy for every table and no write policy anywhere", () => {
    for (const table of BED_SPA_TABLES) {
      expect(sql, `${table} policy`).toContain(
        `on public.${table} for select to authenticated using (true);`,
      );
    }
    expect(sql).not.toMatch(/for (insert|update|delete)/i);
  });

  it("gives every view security_invoker, so RLS applies to the caller", () => {
    for (const fragment of [
      "reporting_bed_usage_facts",
      "reporting_spa_wellness_facts",
      "reporting_spa_engagement_facts",
    ]) {
      const viewSql = statementsOnly(fileNamed(fragment).sql);
      const creates = viewSql.match(/create or replace view/g) ?? [];
      const invokers = viewSql.match(/with \(security_invoker = true\)/g) ?? [];
      expect(invokers.length, `${fragment} views`).toBe(creates.length);
    }
  });

  it("revokes every new function from the browser-held roles", () => {
    const sqlFn = statementsOnly(fileNamed("reporting_bed_spa_ingest_functions").sql);
    for (const fn of [
      "upsert_bed_spa_period",
      "complete_bed_usage_ingestion",
      "complete_spa_wellness_ingestion",
      "complete_spa_engagement_ingestion",
    ]) {
      expect(sqlFn, `${fn} revoked`).toContain(`revoke all on function public.${fn}(`);
    }
  });

  it("pins search_path on every new function", () => {
    // An unpinned search_path is a privilege-escalation path through a
    // shadowed function name.
    const sqlFn = statementsOnly(fileNamed("reporting_bed_spa_ingest_functions").sql);
    const creates = sqlFn.match(/create or replace function/g) ?? [];
    const pinned = sqlFn.match(/set search_path = ''/g) ?? [];
    expect(pinned.length).toBe(creates.length);
  });
});

describe("supersession scope", () => {
  const sqlFn = statementsOnly(fileNamed("reporting_bed_spa_ingest_functions").sql);

  it("scopes every family's supersession to its period and company", () => {
    // A July backfill must not disturb August, and a corrected August must
    // replace only August.
    const scoped = sqlFn.match(/where period_id = v_period_id and company = v_company and superseded_by_ingestion_id is null for update/g) ?? [];
    expect(scoped.length).toBe(3);
  });

  it("reuses the existing period rather than creating a second one", () => {
    expect(sqlFn).toContain("on conflict (grain, period_end) do nothing");
  });

  it("never rewrites a shared period's label, which another report may own", () => {
    /*
     * THE DEFECT THIS PINS. The period row is shared: Bed Usage covers 1-31
     * August and lands on (mtd, 2026-08-31), which the COMP REPORT already
     * created and named. `report_periods.label_raw` is what Salon Performance
     * prints in its scope banner, its salon header and its data source panel —
     * so `do update set label_raw` here retitled a working Comp Report period
     * with the Bed Usage workbook's name and overwrote another report's
     * provenance.
     *
     * The insert still supplies `label_raw` for a period seen for the FIRST
     * time; what must never appear is an update of it.
     */
    expect(sqlFn).toContain("p_period->>'label_raw'");
    expect(sqlFn).not.toMatch(/set\s+label_raw\s*=/);
    // And the id is still resolved when the conflict path returns no row.
    expect(sqlFn).toContain("if v_period_id is null then");
  });

  it("keeps each delivery's own period title, because the shared one is not it", () => {
    /*
     * The period row is SHARED: Bed Usage, SPA Wellness and Spa Engagement all
     * covering August resolve to one `report_periods` row, and the upsert
     * refreshes `label_raw` — so the last delivery in owns it. Reading it as
     * "the period as the source wrote it" showed the Bed Usage tab the SPA
     * Wellness workbook's title.
     *
     * So every snapshot records its OWN title, and all three write it.
     */
    for (const family of [
      "reporting_bed_usage_facts",
      "reporting_spa_wellness_facts",
      "reporting_spa_engagement_facts",
    ]) {
      const sql = statementsOnly(fileNamed(family).sql);
      expect(sql).toMatch(/source_period_label text/);
      // And it reaches the read view, or nothing could show it.
      expect(sql).toMatch(/s\.source_period_label/);
    }

    // Once per family's snapshot. The shared period helper writes the same
    // text into `report_periods` from its own `p_period` parameter, which is
    // the row that gets overwritten — hence the per-snapshot copy.
    const written = sqlFn.match(/p_payload->'period'->>'label_raw'/g) ?? [];
    expect(written.length).toBe(3);
    expect(sqlFn).toContain("p_period->>'label_raw'");
  });

  it("marks the attempt succeeded inside the same transaction as the write", () => {
    // A half-written report must never be marked successful.
    const marked = sqlFn.match(/set status = 'succeeded'/g) ?? [];
    expect(marked.length).toBe(3);
  });

  it("keeps a zero-session row out even if a caller sends one", () => {
    expect(sqlFn).toContain("where i.sessions > 0");
  });

  it("lets only the roster path create a salon", () => {
    // The roster is the only place a salon number appears in the three new
    // reports, so it is the only delivery that can introduce one.
    const inserts = sqlFn.match(/insert into public\.salons \(/g) ?? [];
    expect(inserts.length).toBe(1);
    expect(sqlFn).toContain("complete_spa_engagement_ingestion");
  });
});

describe("the reporting and knowledge domains stay separate", () => {
  it("never references the RAG tables", () => {
    for (const fragment of [
      "reporting_bed_spa_dimensions",
      "reporting_bed_usage_facts",
      "reporting_spa_wellness_facts",
      "reporting_spa_engagement_facts",
      "reporting_bed_spa_rls",
      "reporting_bed_spa_ingest_functions",
    ]) {
      const sql = statementsOnly(fileNamed(fragment).sql);
      expect(sql, fragment).not.toContain("knowledge_documents");
      expect(sql, fragment).not.toContain("knowledge_chunks");
    }
  });

  it("registers the three new sources", () => {
    for (const code of ["bed_usage_email", "spa_wellness_email", "spa_engagement_email"]) {
      expect(ALL, code).toContain(`'${code}'`);
    }
  });
});
