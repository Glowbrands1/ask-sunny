import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../../../../supabase/migrations/20261016001000_google_review_business_profile_api.sql", import.meta.url),
  "utf8",
);
/* Comments can say anything; only executable statements are policed. */
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

describe("Business Profile migration is additive", () => {
  it("drops nothing and rewrites no existing data", () => {
    expect(code).not.toMatch(/\bdrop\s+(table|column|view|type|function|index)\b/i);
    expect(code).not.toMatch(/\balter\s+table[^;]*\bdrop\s+column\b/i);
    expect(code).not.toMatch(/\b(delete\s+from|truncate)\b/i);
    expect(code).not.toMatch(/\brename\b/i);
  });

  it("only ever updates gbp_* columns on existing review tables", () => {
    const updates = [...code.matchAll(/update\s+public\.(google_reviews|google_review_locations)\s+set([\s\S]*?)\bwhere\b/gi)];
    expect(updates.length).toBeGreaterThan(0);
    for (const [, , assignments] of updates) {
      const columns = [...assignments.matchAll(/^\s*,?\s*([a-z_]+)\s*=/gm)].map((m) => m[1]);
      expect(columns.length).toBeGreaterThan(0);
      for (const column of columns) expect(column).toMatch(/^gbp_/);
    }
  });

  it("leaves the dashboard view and the existing dedup key alone", () => {
    expect(code).not.toMatch(/google_reviews_enriched/);
    expect(code).not.toMatch(/google_reviews_external_id_key/);
  });

  it("keeps the new tables server-only and the functions off the browser roles", () => {
    expect(code).toMatch(/alter table public\.google_review_reconciliation_items enable row level security/i);
    expect(code).toMatch(/alter table public\.google_review_gbp_sync_runs enable row level security/i);
    expect(code).toMatch(/alter table public\.google_review_gbp_connections enable row level security/i);
    expect(code).toMatch(/revoke all on public\.google_review_gbp_connections from public, anon, authenticated/i);
    for (const fn of ["gbp_apply_links", "gbp_record_review_items", "gbp_confirm_location_mapping", "gbp_set_connection", "gbp_end_connection", "gbp_claim_run"]) {
      expect(code).toMatch(new RegExp(`revoke all on function public\\.${fn}[^;]*from public, anon, authenticated`, "i"));
    }
  });

  it("forbids two listings sharing a Business Profile location and two rows sharing an official id", () => {
    expect(code).toMatch(/unique index[^;]*google_review_locations_gbp_location_key/i);
    expect(code).toMatch(/unique index[^;]*google_reviews_gbp_review_id_key/i);
  });

  it("stores only a SEALED refresh token, one active connection, and one running sync", () => {
    expect(code).toMatch(/refresh_token_sealed ~ '\^v1/);
    expect(code).toMatch(/unique index[^;]*google_review_gbp_connections_one_active/i);
    expect(code).toMatch(/unique index[^;]*google_review_gbp_sync_runs_one_running/i);
    expect(code).not.toMatch(/\brefresh_token\b(?!_sealed)/);
  });
});
