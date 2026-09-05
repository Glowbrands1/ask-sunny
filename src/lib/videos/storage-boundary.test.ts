import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * INDEXEDDB IS NOT THE CANONICAL VIDEO STORE
 * ============================================================================
 *
 * THE AUDIT FINDING THIS PINS. `getStorageProvider()` returns the IndexedDB
 * provider in both modes, and the old upload dialog called `putBlob` on it. So
 * an uploaded training video's bytes went into the uploader's own browser: no
 * other device could play it, clearing site data destroyed it, and the library
 * showed a record whose file existed nowhere a colleague could reach.
 *
 * The cloud path added in this milestone does not touch that provider. These
 * assertions are structural rather than behavioural because the property is
 * structural: what matters is that no module on the cloud path can reach
 * browser storage at all.
 */

function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const CLOUD_PATH_MODULES = [
  "src/lib/videos/policy.ts",
  "src/lib/videos/repository.ts",
  "src/lib/videos/transcription.ts",
  "src/lib/videos/types.ts",
  "src/app/api/videos/route.ts",
  "src/app/api/videos/[id]/playback/route.ts",
  "src/app/api/videos/[id]/finalize/route.ts",
  "src/features/videos/video-player.tsx",
  "src/features/videos/video-transcript.tsx",
];

describe("the cloud video path never reaches browser storage", () => {
  it("imports no storage provider", () => {
    for (const file of CLOUD_PATH_MODULES) {
      expect(codeOf(file), file).not.toContain("getStorageProvider");
      expect(codeOf(file), file).not.toContain("@/lib/storage");
    }
  });

  it("touches no IndexedDB API", () => {
    for (const file of CLOUD_PATH_MODULES) {
      const code = codeOf(file);
      expect(code, file).not.toContain("indexedDB");
      expect(code, file).not.toContain("putBlob");
      expect(code, file).not.toContain("localStorage");
    }
  });

  it("keeps the server modules server-only", () => {
    for (const file of [
      "src/lib/videos/repository.ts",
      "src/lib/videos/transcription.ts",
    ]) {
      expect(readFileSync(file, "utf8").startsWith('import "server-only";')).toBe(true);
    }
  });

  it("keeps the shared policy importable by both sides", () => {
    // No `server-only`: the upload dialog checks the size before starting a
    // 300 MB transfer. The server re-checks, and so does the bucket.
    expect(readFileSync("src/lib/videos/policy.ts", "utf8")).not.toContain(
      'import "server-only"',
    );
  });
});

describe("the migration is additive and touches nothing that exists", () => {
  const MIGRATION = readFileSync(
    "supabase/migrations/20260906001000_training_videos.sql",
    "utf8",
  );

  it("drops nothing and alters no existing table", () => {
    const sql = MIGRATION.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

    expect(sql).not.toMatch(/\bdrop\s+(table|type|policy|bucket|column)\b/i);
    expect(sql).not.toMatch(/\balter\s+table\s+public\.(knowledge_|report_|comp_|sales_totals|forms_|app_users)/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
  });

  it("creates a new private bucket rather than widening an existing one", () => {
    expect(MIGRATION).toContain("'training-videos'");
    expect(MIGRATION).toMatch(/insert into storage\.buckets/);

    /*
     * Comments stripped: the migration EXPLAINS why it does not widen
     * `knowledge-documents`, so matching the raw file would fail on the
     * explanation. What must be absent is a statement touching those buckets.
     */
    const sql = MIGRATION.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(sql).not.toContain("knowledge-documents");
    expect(sql).not.toContain("reporting-sources");
    expect(sql).not.toMatch(/update\s+storage\.buckets/i);
  });

  it("creates the bucket as private", () => {
    const bucket = MIGRATION.slice(
      MIGRATION.indexOf("insert into storage.buckets"),
      MIGRATION.indexOf("on conflict"),
    );
    expect(bucket).toMatch(/\bfalse\b/);
    expect(bucket).not.toMatch(/\btrue\b/);
  });

  it("creates no storage.objects policy, so no browser role can reach the bytes", () => {
    expect(MIGRATION).not.toMatch(/create policy[\s\S]*storage\.objects/i);
  });

  it("enables and forces RLS on the metadata table with no policies", () => {
    expect(MIGRATION).toContain("enable row level security");
    expect(MIGRATION).toContain("force row level security");
    expect(MIGRATION).toMatch(/revoke all on public\.training_videos from anon, authenticated/);
    expect(MIGRATION).not.toMatch(/create policy .* on public\.training_videos/i);
  });

  it("revokes the new function from PUBLIC, not only from the two roles", () => {
    // Postgres grants EXECUTE to PUBLIC on creation, so revoking from `anon,
    // authenticated` alone is a no-op — a lesson this project already learned
    // once, on accept_invitation.
    expect(MIGRATION).toMatch(
      /revoke all on function public\.touch_training_video_updated_at\(\) from public/,
    );
  });

  it("refuses a ready row with no object", () => {
    expect(MIGRATION).toContain("training_videos_ready_has_object");
  });
});
