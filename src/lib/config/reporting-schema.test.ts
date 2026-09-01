import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * REPORTING SCHEMA INVARIANTS.
 *
 * The Salon Performance / Comp Sales migrations encode several properties that
 * are easy to state in a comment and easy to lose in an edit. This suite parses
 * the SQL and enforces them, in the same spirit as the embedding-dimension
 * invariant test next door.
 *
 * These are STATIC checks over the migration text. They are not a substitute
 * for applying the migrations — that is checkpoint 3 — but they catch the
 * regressions that would otherwise only surface against a live project, which
 * is exactly how the two privilege defects in the knowledge migrations were
 * found the expensive way.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Tables that make up the reporting domain. */
const REPORTING_TABLES = [
  "report_sources",
  "report_files",
  "report_periods",
  "report_ingestions",
  "report_metrics",
  "salons",
  "salon_period_attributes",
  "comp_sales_facts",
] as const;

/** The read surface. A view, and therefore easy to forget when granting. */
const REPORTING_VIEW = "comp_sales_current_facts";

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

function reportingFiles(): { name: string; sql: string }[] {
  return migrationFiles().filter(
    (file) => file.name.includes("reporting") || file.name.includes("comp_sales"),
  );
}

function reportingSql(): string {
  return reportingFiles().map((file) => statementsOnly(file.sql)).join(" ");
}

function fileNamed(fragment: string): { name: string; sql: string } {
  const found = reportingFiles().find((file) => file.name.includes(fragment));
  if (!found) throw new Error(`No reporting migration matching "${fragment}"`);
  return found;
}

describe("reporting migrations exist and are ordered", () => {
  it("ships every reporting migration", () => {
    const names = reportingFiles().map((file) => file.name);
    for (const fragment of [
      "reporting_enums",
      "reporting_sources_and_files",
      "reporting_periods_and_ingestions",
      "reporting_dimensions",
      "comp_sales_facts",
      "reporting_rls",
      "reporting_storage_bucket",
      "reporting_seed_comp_sales",
    ]) {
      expect(names.some((name) => name.includes(fragment)), fragment).toBe(true);
    }
  });

  it("creates every table before the migration that secures it", () => {
    // A grant on a table that does not exist yet fails at apply time, and a
    // table created after its RLS migration is left wide open.
    const files = migrationFiles();
    const rls = files.findIndex((file) => file.name.includes("reporting_rls"));

    for (const table of REPORTING_TABLES) {
      const created = files.findIndex((file) =>
        statementsOnly(file.sql).includes(`create table public.${table} (`),
      );
      expect(created, `${table} is never created`).toBeGreaterThanOrEqual(0);
      expect(created, `${table} is created after its RLS migration`).toBeLessThan(rls);
    }
  });

  it("seeds reference data only after the tables it targets exist", () => {
    const files = migrationFiles();
    const seed = files.findIndex((file) => file.name.includes("reporting_seed"));
    const metrics = files.findIndex((file) => file.name.includes("reporting_dimensions"));
    expect(metrics).toBeLessThan(seed);
  });
});

describe("reporting stays out of the knowledge domain", () => {
  it("never references the RAG tables", () => {
    // Reporting is a separate bounded domain. A foreign key either way would
    // couple two lifecycles that have nothing to do with each other.
    const sql = reportingSql();
    expect(sql).not.toContain("knowledge_documents");
    expect(sql).not.toContain("knowledge_chunks");
  });

  it("keeps the knowledge migrations free of reporting tables", () => {
    const knowledge = migrationFiles()
      .filter((file) => !file.name.includes("reporting") && !file.name.includes("comp_sales"))
      .map((file) => statementsOnly(file.sql))
      .join(" ");

    for (const table of REPORTING_TABLES) {
      expect(knowledge, `knowledge migrations mention ${table}`).not.toContain(
        `public.${table}`,
      );
    }
  });

  it("uses a separate Storage bucket from knowledge documents", () => {
    // Checked against STATEMENTS: the migration's comments legitimately name the
    // knowledge bucket when explaining why this is a separate one.
    const bucket = statementsOnly(fileNamed("reporting_storage_bucket").sql);
    expect(bucket).toContain("'reporting-sources'");
    expect(bucket).not.toContain("knowledge-documents");
  });
});

describe("row level security posture", () => {
  it("enables AND forces row level security on every reporting table", () => {
    const sql = statementsOnly(fileNamed("reporting_rls").sql);

    for (const table of REPORTING_TABLES) {
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
     * REGRESSION, learned from the knowledge tables. Supabase ships
     * `alter default privileges ... grant all on tables to anon, authenticated`,
     * so both roles hold INSERT/UPDATE/DELETE the moment a table is created in
     * `public`. A `grant select` is additive and does NOT take those away.
     */
    const sql = statementsOnly(fileNamed("reporting_rls").sql);

    for (const relation of [...REPORTING_TABLES, REPORTING_VIEW]) {
      expect(sql, `${relation} must be revoked from both roles`).toContain(
        `revoke all on public.${relation} from anon, authenticated;`,
      );
    }
  });

  it("revokes and grants the view as well as the tables", () => {
    /*
     * REGRESSION. Default privileges treat a VIEW as a table, so
     * comp_sales_current_facts inherits the same grants — and it reads every
     * reporting table at once. Securing eight tables and forgetting the view
     * that joins them would leave the whole domain readable.
     */
    const sql = statementsOnly(fileNamed("reporting_rls").sql);
    expect(sql).toContain(`revoke all on public.${REPORTING_VIEW} from anon, authenticated;`);
    expect(sql).toContain(`grant select on public.${REPORTING_VIEW} to authenticated;`);
  });

  it("grants the anonymous role nothing, anywhere in the reporting domain", () => {
    // `revoke ... from anon, authenticated` is expected and required; what must
    // never appear is a grant in anon's direction.
    const sql = reportingSql();
    expect(sql).not.toMatch(/\bto anon\b/);
    expect(sql).not.toMatch(/grant[^;]*\banon\b/i);
  });

  it("grants authenticated select and nothing else", () => {
    const sql = statementsOnly(fileNamed("reporting_rls").sql);

    for (const relation of [...REPORTING_TABLES, REPORTING_VIEW]) {
      expect(sql, `${relation}`).toContain(`grant select on public.${relation} to authenticated;`);
    }
    // No write privilege is granted to a browser-held role by any statement.
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)\b[^;]*to (anon|authenticated)/i);
  });

  it("creates no write policy for any browser role", () => {
    // A grant alone reads nothing under RLS, and a policy alone is refused by
    // the grant. Writes must have neither.
    const sql = statementsOnly(fileNamed("reporting_rls").sql);
    expect(sql).not.toMatch(/create policy[^;]*for (insert|update|delete|all)/i);
  });

  it("makes the read view run as the caller, not as its owner", () => {
    /*
     * WITHOUT THIS THE VIEW DEFEATS ROW LEVEL SECURITY ON EVERY TABLE AT ONCE.
     *
     * A plain PostgreSQL view runs with its OWNER's privileges and RLS context.
     * This view is owned by the migration role, which holds BYPASSRLS on
     * Supabase, so it would read every row beneath it and hand the result to
     * anyone who could select from the view.
     *
     * Demonstrated against a live PostgreSQL in
     * supabase/tests/reporting_schema_checks.sql: a role with grants but no
     * policy sees 0 rows through the view with security_invoker, and 2 rows
     * through the same view without it while still seeing 0 through the table
     * underneath.
     */
    const sql = statementsOnly(fileNamed("comp_sales_facts").sql);
    expect(sql).toContain(`create view public.${REPORTING_VIEW} with (security_invoker = true)`);
    // The caller needs the base tables too: security_invoker means the view is
    // a convenience join, not a privilege boundary.
    const rls = statementsOnly(fileNamed("reporting_rls").sql);
    for (const table of REPORTING_TABLES) {
      expect(rls, `${table} must be selectable for the view to resolve`).toContain(
        `grant select on public.${table} to authenticated;`,
      );
    }
  });

  it("creates no storage.objects policy", () => {
    /*
     * The raw workbooks carry salon financials. Access is server-side only,
     * through the secret key, with short-lived signed URLs minted after
     * authorization — never a blanket read policy for a browser role.
     */
    const sql = reportingSql();
    expect(sql).not.toMatch(/create policy[^;]*on storage\.objects/i);
    expect(sql).not.toMatch(/grant[^;]*on storage\.objects/i);
  });

  it("keeps the reporting bucket private", () => {
    const sql = fileNamed("reporting_storage_bucket").sql;
    // The `public` column of storage.buckets must be false. Company financials
    // behind a guessable URL is the failure this asserts against.
    expect(sql).toMatch(/'reporting-sources',\s*\n?\s*false/);
    expect(sql).not.toMatch(/'reporting-sources',\s*\n?\s*true/);
  });
});

describe("the salon business key survives round trips", () => {
  it("declares salon_number as text, never a numeric type", () => {
    /*
     * THE ZERO-PADDING HAZARD. Source salon numbers look like '0468'. Read as
     * an integer the leading zero is lost, and the next report that reads it
     * correctly creates a SECOND salon for the same store — silently splitting
     * its history in two. Verified against a live Postgres: '0468' and '468'
     * are two distinct rows under the unique constraint.
     */
    const sql = statementsOnly(fileNamed("reporting_dimensions").sql);
    expect(sql).toContain("salon_number text not null");
    expect(sql).not.toMatch(/salon_number\s+(integer|bigint|smallint|numeric)/i);
    expect(sql).toContain("constraint salons_salon_number_key unique (salon_number)");
  });

  it("refuses a salon number with surrounding whitespace", () => {
    const sql = statementsOnly(fileNamed("reporting_dimensions").sql);
    expect(sql).toContain("constraint salons_salon_number_format");
  });
});

describe("the metric catalogue is a controlled vocabulary", () => {
  it("makes facts reference metrics by foreign key, not by name", () => {
    const sql = statementsOnly(fileNamed("comp_sales_facts").sql);
    expect(sql).toContain("metric_id uuid not null");
    // No free-text metric name column on the fact table.
    expect(sql).not.toMatch(/metric_code\s+text/i);
  });

  it("enforces the basis-year rule in the database, not only in the parser", () => {
    /*
     * The composite foreign key targets (id, basis_year_required) TOGETHER, so
     * a fact whose flag disagrees with the catalogue has no parent row to point
     * at. The check then ties the flag to the value actually present. Between
     * them, a metric that needs a year cannot be stored without one.
     */
    const facts = statementsOnly(fileNamed("comp_sales_facts").sql);
    const dims = statementsOnly(fileNamed("reporting_dimensions").sql);

    expect(facts).toContain("foreign key (metric_id, metric_basis_year_required)");
    expect(facts).toContain("references public.report_metrics (id, basis_year_required)");
    expect(facts).toContain(
      "check (metric_basis_year_required = (basis_year is not null))",
    );
    // The composite reference is only legal because of this unique constraint.
    expect(dims).toContain(
      "constraint report_metrics_id_basis_year_key unique (id, basis_year_required)",
    );
  });

  it("stores money and counts as numeric, never floating point", () => {
    const sql = statementsOnly(fileNamed("comp_sales_facts").sql);
    expect(sql).toContain("value numeric not null");
    expect(sql).not.toMatch(/value\s+(double precision|real|float)/i);
  });

  it("seeds reference data idempotently and with no report content", () => {
    const seed = fileNamed("reporting_seed_comp_sales");
    const inserts = statementsOnly(seed.sql).match(/insert into/gi) ?? [];
    const guards = statementsOnly(seed.sql).match(/on conflict[^;]*do nothing/gi) ?? [];
    expect(inserts.length).toBeGreaterThan(0);
    expect(guards.length, "every seed insert must be idempotent").toBe(inserts.length);
    // Reference data only: no salon, no figure, no period from a real report.
    expect(statementsOnly(seed.sql)).not.toContain("insert into public.salons");
    expect(statementsOnly(seed.sql)).not.toContain("insert into public.comp_sales_facts");
  });
});

describe("history is preserved rather than overwritten", () => {
  it("gives facts and attributes a supersession column", () => {
    const facts = statementsOnly(fileNamed("comp_sales_facts").sql);
    const dims = statementsOnly(fileNamed("reporting_dimensions").sql);

    for (const [label, sql] of [["facts", facts], ["attributes", dims]] as const) {
      expect(sql, label).toContain(
        "superseded_by_ingestion_id uuid references public.report_ingestions (id)",
      );
    }
  });

  it("scopes the business key to live rows only", () => {
    /*
     * IDEMPOTENCY LAYER 3. At most one live fact per salon, period, metric and
     * baseline year, so a second report for a period already loaded cannot
     * double the numbers. The partial predicate is what lets a correction be
     * inserted alongside its predecessor instead of replacing it.
     */
    const facts = statementsOnly(fileNamed("comp_sales_facts").sql);
    expect(facts).toContain(
      "create unique index comp_sales_facts_live_key on public.comp_sales_facts (salon_id, period_id, metric_id, coalesce(basis_year, -1)) where superseded_by_ingestion_id is null",
    );

    const dims = statementsOnly(fileNamed("reporting_dimensions").sql);
    expect(dims).toContain(
      "create unique index salon_period_attributes_live_key on public.salon_period_attributes (salon_id, period_id) where superseded_by_ingestion_id is null",
    );
  });

  it("never deletes a fact or an attribute row in a migration", () => {
    const sql = reportingSql();
    expect(sql).not.toMatch(/delete from public\.comp_sales_facts/i);
    expect(sql).not.toMatch(/delete from public\.salon_period_attributes/i);
  });

  it("only ever updates a fact to STAMP it superseded, never to restate it", () => {
    /*
     * Corrections supersede; they never overwrite. Supersession is implemented
     * by setting `superseded_by_ingestion_id` on the outgoing row — that IS the
     * mechanism, so an UPDATE is expected here.
     *
     * What must never appear is an update that touches anything else: the
     * moment a migration can rewrite `value`, "what did the report say when it
     * first arrived" stops being answerable, which is the whole point of
     * keeping the old row. So every assignment is checked, not just the
     * presence of an UPDATE.
     */
    const sql = reportingSql();
    let inspected = 0;
    for (const table of ["comp_sales_facts", "salon_period_attributes"] as const) {
      const pattern = new RegExp(`update public\\.${table}\\s+set\\s+([\\s\\S]*?)\\s+where`, "gi");
      for (const match of sql.matchAll(pattern)) {
        inspected += 1;
        const assigned = match[1]
          .split(",")
          .map((assignment) => assignment.split("=")[0].trim().toLowerCase());
        expect(assigned, `${table} update assigns more than the supersession stamp`).toEqual([
          "superseded_by_ingestion_id",
        ]);
      }
    }
    // Guard against a vacuous pass: the supersession updates DO exist, so if
    // the pattern matched nothing the assertion above proved nothing.
    expect(inspected, "no supersession update was found to inspect").toBeGreaterThanOrEqual(2);
  });

  it("keeps each reporting period independently addressable", () => {
    // Aug 16, Aug 23 and Aug 30 must be separate rows, not one row overwritten.
    const sql = statementsOnly(fileNamed("reporting_periods_and_ingestions").sql);
    expect(sql).toContain("constraint report_periods_grain_end_key unique (grain, period_end)");
  });
});

describe("idempotency and lineage", () => {
  it("makes file content identity unique", () => {
    const sql = statementsOnly(fileNamed("reporting_sources_and_files").sql);
    expect(sql).toContain("constraint report_files_sha256_key unique (file_sha256)");
    expect(sql).toContain("check (file_sha256 ~ '^[0-9a-f]{64}$')");
  });

  it("makes delivery identity unique only where one exists", () => {
    // Partial, so many files with no upstream id do not collide with each other.
    const sql = statementsOnly(fileNamed("reporting_sources_and_files").sql);
    expect(sql).toContain(
      "create unique index report_files_source_message_key on public.report_files (source_id, external_message_id) where external_message_id is not null",
    );
  });

  it("lets a failed parse be retried without destroying its record", () => {
    /*
     * RETRY SEMANTICS. A blanket unique on (file_id, parser_key,
     * parser_version) would make a failed ingestion permanently unretryable:
     * the only ways forward would be deleting the failed row or updating it in
     * place, and both erase what went wrong — which is exactly the row an
     * operator needs. Attempts are therefore unconstrained.
     */
    const sql = statementsOnly(fileNamed("reporting_periods_and_ingestions").sql);
    expect(sql).not.toMatch(
      /unique \(file_id, parser_key, parser_version\)\s*,/,
    );
  });

  it("allows at most one attempt per file and parser version to succeed", () => {
    /*
     * The other half of the same rule: retries are free, SUCCESS is unique. So
     * "these bytes have already been loaded by this parser version" is a fact
     * the database guarantees rather than something the repository remembers.
     * Duplicate facts are independently impossible via the live business key.
     */
    const sql = statementsOnly(fileNamed("reporting_periods_and_ingestions").sql);
    expect(sql).toContain(
      "create unique index report_ingestions_one_success_key on public.report_ingestions (file_id, parser_key, parser_version) where status = 'succeeded'",
    );
  });

  it("refuses an ingestion that claims success without evidence", () => {
    // Same shape as knowledge_documents_indexed_requires_status: a status is a
    // claim, and the schema refuses claims the data does not support.
    const sql = statementsOnly(fileNamed("reporting_periods_and_ingestions").sql);
    expect(sql).toContain("constraint report_ingestions_succeeded_requires_period");
    expect(sql).toContain("constraint report_ingestions_failed_requires_reason");
  });

  it("keeps the lineage chain unbroken by foreign key", () => {
    // fact -> ingestion -> file -> source, plus cell-level columns on the fact.
    const facts = statementsOnly(fileNamed("comp_sales_facts").sql);
    const ing = statementsOnly(fileNamed("reporting_periods_and_ingestions").sql);
    const files = statementsOnly(fileNamed("reporting_sources_and_files").sql);

    expect(facts).toContain("ingestion_id uuid not null references public.report_ingestions (id)");
    expect(facts).toContain("source_sheet text not null");
    expect(facts).toContain("source_column text not null");
    expect(ing).toContain("file_id uuid not null references public.report_files (id)");
    expect(files).toContain("source_id uuid not null references public.report_sources (id)");
  });

  it("records which sheets an ingestion actually read", () => {
    // The workbook carries an abandoned block of template columns that must
    // never be ingested, so what was read is part of the lineage answer.
    const sql = statementsOnly(fileNamed("reporting_periods_and_ingestions").sql);
    expect(sql).toContain("source_sheet_names text[] not null default '{}'");
  });
});

describe("extensibility to further report families", () => {
  it("names the fact table after its family rather than generically", () => {
    // One controlled fact model per report family. A single generic facts table
    // shared by comp, KPI and bonus reports would have no way to say what a row
    // means, and nowhere to put family-specific columns.
    const names = reportingFiles().map((file) => file.name);
    expect(names.some((name) => name.includes("comp_sales_facts"))).toBe(true);
    expect(reportingSql()).not.toMatch(/create table public\.report_facts\b/i);
  });

  it("keeps the dimensions family-agnostic", () => {
    // salons, report_periods, report_metrics and the lineage tables carry no
    // comp-sales-specific column, so a KPI parser reuses them untouched.
    const shared = [
      statementsOnly(fileNamed("reporting_sources_and_files").sql),
      statementsOnly(fileNamed("reporting_periods_and_ingestions").sql),
      statementsOnly(fileNamed("reporting_dimensions").sql),
    ].join(" ");

    expect(shared).not.toContain("comp_sales_facts");
    // The family a source feeds is data, not a column name.
    expect(shared).toContain("report_family text not null");
  });
});
