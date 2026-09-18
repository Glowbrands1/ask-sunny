import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * THE INVARIANTS THAT LIVE IN SQL AND IN FILE LAYOUT
 * ============================================================================
 *
 * Four properties this integration rests on cannot be asserted from a unit
 * test, because the thing enforcing them is a constraint, an index, a `revoke`
 * or the absence of a statement. They are asserted here by reading the source
 * AS TEXT — the same technique `store-codes.test.ts` already uses to keep three
 * copies of the store-code list honest.
 *
 *   ONE CANONICAL REVIEW. Brave and Apify write to `(source,
 *   external_review_id)` with the SAME `source`, so the same Google review
 *   found twice is one row. The transport is recorded beside it.
 *
 *   A FAILED RUN ERASES NOTHING. There is no delete, no truncate and no "make
 *   the listing's reviews match what came back" anywhere in this integration.
 *
 *   ONE RUN AT A TIME. The lock is a partial unique index in Postgres, not a
 *   flag a crashed process can leave set.
 *
 *   THE TOKEN IS SERVER-SIDE. It is never in the extension, never in a client
 *   component, and never NEXT_PUBLIC_.
 */

const repoRoot = process.cwd();

function read(...parts: string[]): string {
  return readFileSync(join(repoRoot, ...parts), "utf8");
}

const migration = read(
  "supabase",
  "migrations",
  "20260918001000_google_review_apify_source.sql",
);

/** Every migration this integration owns. Scanned together where the rule is shared. */
const apifyMigrations = [
  migration,
  read("supabase", "migrations", "20260918002000_google_review_apify_discovery.sql"),
];

const apifyDir = join(repoRoot, "src", "lib", "reviews", "apify");
const apifySources = readdirSync(apifyDir)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => ({ name, text: readFileSync(join(apifyDir, name), "utf8") }));

describe("one canonical review, whichever transport found it", () => {
  it("adds no second value to the review's IDENTITY namespace", () => {
    /*
     * `google_review_source` is half of `unique (source, external_review_id)`.
     * Adding 'apify' there would mean the same review discovered twice becomes
     * two rows, two entries in every total and two items in the response queue.
     */
    expect(migration).not.toMatch(/alter\s+type\s+public\.google_review_source/i);
    expect(migration).not.toMatch(/google_review_source[^;]*add\s+value/i);
  });

  it("records the transport in its own type, separate from the identity", () => {
    expect(migration).toContain(
      "create type public.google_review_ingestion_source as enum ('brave_extension', 'apify')",
    );
    expect(migration).toContain("add column if not exists first_ingestion_source");
    expect(migration).toContain("add column if not exists last_ingestion_source");
  });

  it("looks an existing review up by Google's id alone, not by id AND transport", () => {
    /*
     * THE LINE THAT MAKES DEDUPLICATION WORK ACROSS SOURCES. If the lookup
     * carried the transport, an Apify run would never find the row Brave
     * created, and every review would exist twice.
     */
    const lookups = [
      ...migration.matchAll(
        /from public\.google_reviews r\s+where r\.source = 'google_business_profile'\s+and r\.external_review_id = v_external/g,
      ),
    ];
    expect(lookups.length).toBeGreaterThan(0);
    expect(migration).not.toMatch(/and r\.(first_|last_)?ingestion_source\s*=/);
  });

  it("never rewrites which transport DISCOVERED a review", () => {
    /* A review Brave found and Apify re-read was still discovered by Brave. */
    expect(migration).toContain("last_ingestion_source     = p_ingestion_source");
    expect(migration).not.toMatch(/set[^;]*first_ingestion_source\s*=/);
  });

  it("does not count a change of transport as a change to the review", () => {
    /*
     * Otherwise every review would report as "updated" forever once both
     * sources run, and "3 new, 5 already synced" would stop meaning anything.
     */
    const changed = migration.slice(
      migration.indexOf("v_changed :="),
      migration.indexOf("update public.google_reviews r\n       set last_seen_at"),
    );
    expect(changed).not.toContain("ingestion_source");
  });
});

describe("a failed run erases nothing", () => {
  it("no migration in this integration deletes or truncates anything", () => {
    for (const sql of apifyMigrations) {
      expect(sql).not.toMatch(/delete\s+from/i);
      expect(sql).not.toMatch(/truncate/i);
      /* Nor drops a column, which is the other way to lose the Brave data. */
      expect(sql).not.toMatch(/drop\s+column/i);
    }
  });

  it("no Apify module deletes a review, a location or a run", () => {
    for (const source of apifySources) {
      expect(source.text, source.name).not.toMatch(/\.delete\(/);
      expect(source.text, source.name).not.toMatch(/delete\s+from/i);
    }
  });

  it("the Apify routes hold no DELETE handler", () => {
    const routes = [
      read("src", "app", "api", "reviews", "apify", "webhook", "route.ts"),
      read("src", "app", "api", "reviews", "apify", "cron", "route.ts"),
      read("src", "app", "api", "admin", "reviews", "apify", "sync", "route.ts"),
      read("src", "app", "api", "admin", "reviews", "apify", "locations", "route.ts"),
    ];
    for (const route of routes) {
      expect(route).not.toMatch(/export async function DELETE/);
    }
  });
});

describe("one run at a time, and a bounded number of them", () => {
  it("enforces the single live run with a partial unique index", () => {
    /*
     * A CONSTRAINT RATHER THAN A CONVENTION. Two concurrent starts race inside
     * Postgres; one inserts, the other is refused. No advisory lock to leak, no
     * flag a crashed process can leave set, and no way for a future route to
     * forget.
     */
    expect(migration).toContain("create unique index if not exists google_review_apify_runs_one_live");
    expect(migration).toContain("where status = 'running'");
  });

  it("checks the daily budget inside the same function that takes the lock", () => {
    const claim = migration.slice(
      migration.indexOf("create or replace function public.google_review_apify_claim_run"),
      migration.indexOf("revoke all on function public.google_review_apify_claim_run"),
    );
    expect(claim).toContain("p_max_runs_per_day");
    expect(claim).toContain("over_budget");
    /* The window is rolling, so a bug at 23:50 gets no fresh allowance at 00:00. */
    expect(claim).toContain("interval '24 hours'");
  });

  it("reaps an abandoned claim as FAILED rather than deleting it", () => {
    /* A run that really did charge us must stay visible and stay counted. */
    expect(migration).toContain("'code', 'run_abandoned'");
    expect(migration).toMatch(/set status = 'failed',\s+finished_at = now\(\)/);
  });
});

describe("the review tables stay server-only", () => {
  it("revokes the new table and views from the browser's keys", () => {
    expect(migration).toContain(
      "revoke all on table public.google_review_apify_runs from anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all on public.google_review_apify_locations from anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all on public.google_review_source_reconciliation from anon, authenticated",
    );
  });

  it("forces row level security on the run ledger", () => {
    expect(migration).toContain(
      "alter table public.google_review_apify_runs force row level security",
    );
  });

  it("revokes the new functions from every browser-reachable role", () => {
    for (const fn of [
      "google_review_apify_claim_run",
      "google_review_apify_release_run",
      "google_review_apify_attach_run",
      "google_review_apify_record_outcome",
      "google_review_apify_set_place",
      "ingest_google_reviews",
    ]) {
      expect(migration, fn).toContain(`revoke all on function public.${fn}`);
    }
  });
});

describe("the Apify token never leaves the server", () => {
  it("is held only behind `server-only`", () => {
    const config = apifySources.find((source) => source.name === "config.ts");
    expect(config?.text).toMatch(/^import "server-only";/);
  });

  it("is never NEXT_PUBLIC_ anywhere in the repository's own source", () => {
    expect(read(".env.example")).not.toContain("NEXT_PUBLIC_APIFY");
    for (const source of apifySources) {
      expect(source.text, source.name).not.toContain("NEXT_PUBLIC_APIFY");
    }
  });

  it("never reaches the browser extension", () => {
    /*
     * THE EXTENSION IS A FALLBACK AND KEEPS ITS OWN NARROW CREDENTIAL, which
     * can file reviews for fifteen stores and cannot spend a penny. Nothing
     * about the server-side source is installed into it.
     */
    const extensionDir = join(repoRoot, "extension");
    for (const name of readdirSync(extensionDir)) {
      if (!name.endsWith(".js") && !name.endsWith(".json") && !name.endsWith(".html")) {
        continue;
      }
      const text = readFileSync(join(extensionDir, name), "utf8");
      expect(text, name).not.toContain("APIFY");
      expect(text.toLowerCase(), name).not.toContain("apify.com");
    }
  });

  it("is sent as a header and never as a query parameter", () => {
    /*
     * A secret in a URL is written into every log between this process and
     * Apify, and survives rotation in all of them.
     */
    const client = apifySources.find((source) => source.name === "client.ts");
    expect(client?.text).toContain("authorization: `Bearer ${token}`");
    expect(client?.text).not.toMatch(/token=\$\{/);
    expect(client?.text).not.toMatch(/set\("token"/);
  });

  it("is never rendered by a client component", () => {
    const actions = read("src", "features", "reviews", "apify", "source-actions.tsx");
    expect(actions).toContain('"use client"');

    /*
     * COMMENTS ARE STRIPPED FIRST. The file NAMES the variables in prose, to
     * explain why it cannot reach them; what must not appear is a line of code
     * that reads one.
     */
    const code = actions.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("APIFY_TOKEN");
    expect(code).not.toContain("APIFY_WEBHOOK_SECRET");
    expect(code).not.toContain("process.env");
  });
});

describe("the reporting rule is untouched", () => {
  it("does not redefine the generated eligibility column", () => {
    /*
     * 3, 4 and 5 count; 1 and 2 are stored, shown and never counted. It is a
     * generated column over the rating, so no ingestion path can reach it —
     * including this one, which is why this migration must not touch it.
     */
    expect(migration).not.toContain("eligible_for_weekly_count");
  });

  it("keeps default-deny on the reporting period", () => {
    /* A review is assigned only where the caller PROVED it sits above the
       anchor and that anchor has not moved since. */
    expect(migration).toContain(
      "v_assign := coalesce((v_item ->> 'periodAssignment') = 'current', false)",
    );
    expect(migration).toContain("and coalesce((v_store_ok ->> v_store)::boolean, false)");
  });

  it("never moves a review that is already assigned to a period", () => {
    expect(migration).toContain(
      "case when r.reporting_period_id is null and v_assign",
    );
  });

  it("prefers a real publication instant over Google's bucketed wording", () => {
    expect(migration).toContain("v_estimate := coalesce(\n      v_absolute,");
  });
});

describe("a listing cannot be scraped until somebody verified which listing it is", () => {
  it("refuses to record `verified` without the evidence for it", () => {
    const constraint = migration.slice(
      migration.indexOf("google_review_locations_verified_has_evidence"),
    );
    expect(constraint).toContain("google_place_id is not null");
    expect(constraint).toContain("canonical_google_name is not null");
    expect(constraint).toContain("canonical_google_address is not null");
    expect(constraint).toContain("apify_last_verified_at is not null");
  });

  it("refuses to let two salons share one Google listing", () => {
    expect(migration).toContain(
      "add constraint google_review_locations_place_id_key unique (google_place_id)",
    );
  });

  it("KEEPS MANUAL PLACE ID ENTRY AS A FALLBACK", () => {
    /*
     * Discovery resolves most listings and will not resolve all of them. The
     * form that takes a pasted identifier is what closes the gap, so it stays
     * on the screen and stays wired to the route.
     */
    const screen = read("src", "features", "reviews", "apify", "source-screen.tsx");
    expect(screen).toContain("LocationMappingForm");
    expect(screen).toContain("fallback");

    const actions = read("src", "features", "reviews", "apify", "source-actions.tsx");
    expect(actions).toContain("export function LocationMappingForm");
    expect(actions).toContain("/api/admin/reviews/apify/locations");
  });

  it("has no route field that can write `verified` directly", () => {
    /*
     * `verified` means "Google's own answer was checked against the roster". A
     * form post is not that, so the only status a POST can write is pending.
     */
    const route = read(
      "src",
      "app",
      "api",
      "admin",
      "reviews",
      "apify",
      "locations",
      "route.ts",
    );
    expect(route).toContain('status: "pending_verification"');
    expect(route).not.toMatch(/status:\s*"verified"/);
  });
});
