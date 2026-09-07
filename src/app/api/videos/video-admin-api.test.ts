import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PERMISSION_MATRIX } from "@/lib/permissions";

/**
 * ============================================================================
 * EDITING AND DELETING A TRAINING VIDEO
 * ============================================================================
 *
 * Two properties carry the weight here:
 *
 *   AN EDIT CANNOT REACH A SYSTEM COLUMN. Not because a deny-list strips them,
 *   but because the path from request to SQL names six fields at each end. A
 *   request carrying `status` or `storage_path` is never read.
 *
 *   A DELETE TAKES THE ROW FIRST. A private orphaned object is untidy and
 *   invisible; a `ready` row whose media is gone is a video in the library that
 *   cannot be played, with nothing to explain why.
 */

const ROUTE_SOURCE = readFileSync("src/app/api/videos/[id]/route.ts", "utf8");
const REPOSITORY_SOURCE = readFileSync("src/lib/videos/repository.ts", "utf8");

const ORIGINAL = { ...process.env };
const VIDEO_ID = "8f14e45f-ceea-4e78-b2a7-1c1b1a2b3c4d";

interface Trace {
  authorized: string[];
  updates: Record<string, unknown>[];
  deletes: number;
  removedPaths: string[][];
}

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  process.env.ANTHROPIC_API_KEY = "test";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID,
    title: "Adamant: In a hurry",
    description: "",
    category: "leadership",
    duration_seconds: 17,
    uploaded_by_name: "Manager",
    uploaded_at: "2026-09-06T00:00:00Z",
    equipment: [],
    keywords: [],
    tags: [],
    storage_bucket: "training-videos",
    storage_path: `${VIDEO_ID}/source.mp4`,
    mime_type: "video/mp4",
    size_bytes: 1024,
    status: "ready",
    transcript_status: "not_configured",
    transcript_text: null,
    transcript_error_safe: null,
    transcript_provider: null,
    view_count: 0,
    thumbnail_tone: "sage",
    ...overrides,
  };
}

async function loadRoute(
  options: {
    role?: string | null;
    row?: Record<string, unknown> | null;
    updateReturns?: Record<string, unknown> | null;
    deleteReturns?: { id: string }[];
    deleteError?: { message: string } | null;
    removeError?: { message: string } | null;
  } = {},
) {
  vi.resetModules();

  const trace: Trace = { authorized: [], updates: [], deletes: 0, removedPaths: [] };
  const role = options.role === undefined ? "district_manager" : options.role;
  const stored = options.row === undefined ? row() : options.row;

  vi.doMock("@/lib/auth/server", async () => {
    const { AuthError } = await import("@/lib/auth/types");
    return {
      authorizeRequest: async (_request: Request, permission: string) => {
        trace.authorized.push(permission);
        if (role === null) throw new AuthError("unauthenticated", "You are not signed in.");
        const granted =
          DEFAULT_PERMISSION_MATRIX[role as keyof typeof DEFAULT_PERMISSION_MATRIX];
        if (!granted?.includes(permission as never)) {
          throw new AuthError("forbidden", "Your role does not have permission to do that.");
        }
        return { identity: { role, subject: "u1" }, permission, provider: "supabase" };
      },
    };
  });

  vi.doMock("@/lib/supabase/server", () => ({
    KNOWLEDGE_BUCKET: "knowledge-documents",
    getSupabaseAdmin: () => ({
      from: () => {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        Object.assign(builder, {
          select: chain,
          eq: chain,
          in: chain,
          order: async () => ({ data: stored ? [stored] : [], error: null }),
          maybeSingle: async () => ({
            data:
              trace.updates.length > 0
                ? (options.updateReturns === undefined
                    ? { ...stored, ...trace.updates[0] }
                    : options.updateReturns)
                : stored,
            error: null,
          }),
          update: (values: Record<string, unknown>) => {
            trace.updates.push(values);
            return builder;
          },
          delete: () => {
            trace.deletes += 1;
            return {
              eq: () => ({
                select: async () =>
                  options.deleteError
                    ? { data: null, error: options.deleteError }
                    : {
                        data:
                          options.deleteReturns === undefined
                            ? [{ id: VIDEO_ID }]
                            : options.deleteReturns,
                        error: null,
                      },
              }),
            };
          },
        });
        return builder;
      },
      storage: {
        from: () => ({
          remove: async (paths: string[]) => {
            trace.removedPaths.push(paths);
            return { data: null, error: options.removeError ?? null };
          },
        }),
      },
    }),
    __setSupabaseAdmin: () => {},
  }));

  const route = await import("./[id]/route");
  return { route, trace };
}

function patch(body: unknown): Request {
  return new Request(`https://app.test/api/videos/${VIDEO_ID}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
    },
    body: JSON.stringify(body),
  });
}

function del(): Request {
  return new Request(`https://app.test/api/videos/${VIDEO_ID}`, {
    method: "DELETE",
    headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250) + 1}` },
  });
}

const params = { params: Promise.resolve({ id: VIDEO_ID }) };
const VALID = { title: "Adamant: In a hurry", category: "training" };

/* ---------------------------------------------------------------- edit -- */

describe("editing metadata requires manage_videos", () => {
  it("lets a manager change the category without re-uploading", async () => {
    const { route, trace } = await loadRoute();
    const response = await route.PATCH(patch(VALID), params);

    expect(response.status).toBe(200);
    expect(trace.authorized).toEqual(["manage_videos"]);
    expect(trace.updates[0]).toMatchObject({ category: "training" });
    // The bytes are not involved at all.
    expect(trace.removedPaths).toEqual([]);
  });

  it("refuses Employee, who may view but not manage", async () => {
    const { route, trace } = await loadRoute({ role: "employee" });
    const response = await route.PATCH(patch(VALID), params);

    expect(response.status).toBe(403);
    expect(trace.updates).toEqual([]);
  });

  it("refuses an unauthenticated caller", async () => {
    const { route, trace } = await loadRoute({ role: null });
    expect((await route.PATCH(patch(VALID), params)).status).toBe(401);
    expect(trace.updates).toEqual([]);
  });

  it("returns the updated record", async () => {
    const { route } = await loadRoute();
    const response = await route.PATCH(patch(VALID), params);
    const payload = (await response.json()) as { video: { category: string } };

    expect(payload.video.category).toBe("training");
  });

  it("404s for a video that does not exist", async () => {
    const { route } = await loadRoute({ row: null, updateReturns: null });
    expect((await route.PATCH(patch(VALID), params)).status).toBe(404);
  });
});

describe("an edit cannot reach a system column", () => {
  const FORBIDDEN = {
    ...VALID,
    id: "00000000-0000-4000-8000-000000000000",
    status: "ready",
    storage_path: "../knowledge-documents/policy.pdf",
    storagePath: "../elsewhere/source.mp4",
    storage_bucket: "knowledge-documents",
    mime_type: "text/html",
    size_bytes: 999999999,
    uploaded_by_user_id: "00000000-0000-4000-8000-000000000001",
    uploaded_by_name: "Somebody Else",
    uploaded_at: "1999-01-01T00:00:00Z",
    transcript_status: "ready",
    transcript_text: "a transcript nobody produced",
    transcript_provider: "invented",
    view_count: 9999,
  };

  it("writes only the six editable columns", async () => {
    const { route, trace } = await loadRoute();
    await route.PATCH(patch(FORBIDDEN), params);

    expect(Object.keys(trace.updates[0]).sort()).toEqual([
      "category",
      "description",
      "equipment",
      "keywords",
      "tags",
      "title",
    ]);
  });

  it("does not alter status, storage path, size or bucket", async () => {
    const { route, trace } = await loadRoute();
    await route.PATCH(patch(FORBIDDEN), params);

    const written = trace.updates[0];
    for (const key of [
      "status",
      "storage_path",
      "storagePath",
      "storage_bucket",
      "mime_type",
      "size_bytes",
    ]) {
      expect(written, key).not.toHaveProperty(key);
    }
  });

  it("does not alter any transcript field", async () => {
    const { route, trace } = await loadRoute();
    await route.PATCH(patch(FORBIDDEN), params);

    const written = JSON.stringify(trace.updates[0]);
    expect(written).not.toContain("transcript");
    expect(written).not.toContain("a transcript nobody produced");
  });

  it("does not alter uploader identity or view count", async () => {
    const { route, trace } = await loadRoute();
    await route.PATCH(patch(FORBIDDEN), params);

    const written = trace.updates[0];
    expect(written).not.toHaveProperty("uploaded_by_user_id");
    expect(written).not.toHaveProperty("uploaded_by_name");
    expect(written).not.toHaveProperty("uploaded_at");
    expect(written).not.toHaveProperty("view_count");
  });

  it("carries no spread or Partial<> on the path from request to SQL", () => {
    /*
     * The structural guarantee. A `Partial<TrainingVideo>` or a `...body`
     * anywhere on this path is how a seventh column eventually gets through,
     * so neither exists.
     */
    const code = ROUTE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    /*
     * ANY spread of the request, however it is parenthesised or cast. An
     * earlier version of this assertion matched only `...body` and sailed
     * straight past `...(body as Record<string, unknown>)` — the exact shape a
     * careless edit would take.
     */
    expect(code).not.toMatch(/\.\.\.\s*\(?\s*body\b/);
    expect(code).not.toMatch(/Partial<TrainingVideo>/);

    const repo = REPOSITORY_SOURCE.slice(
      REPOSITORY_SOURCE.indexOf("export async function updateTrainingVideoMetadata"),
    );
    expect(repo).not.toMatch(/\.\.\.input/);
    expect(repo).not.toMatch(/Record<string, unknown>/);
  });

  it("lets the trigger own updated_at rather than setting it", () => {
    const repo = REPOSITORY_SOURCE.slice(
      REPOSITORY_SOURCE.indexOf("export async function updateTrainingVideoMetadata"),
      REPOSITORY_SOURCE.indexOf("export async function deleteTrainingVideoRow"),
    );
    expect(repo).not.toContain("updated_at");
  });
});

describe("edit validation", () => {
  it("rejects a category outside the canonical list", async () => {
    const { route, trace } = await loadRoute();
    const response = await route.PATCH(
      patch({ ...VALID, category: "made_up_category" }),
      params,
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/not a video category/);
    expect(trace.updates).toEqual([]);
  });

  it("accepts every canonical category", async () => {
    for (const category of [
      "sales",
      "leadership",
      "equipment",
      "cleaning",
      "troubleshooting",
      "operations",
      "training",
    ]) {
      const { route } = await loadRoute();
      const response = await route.PATCH(patch({ ...VALID, category }), params);
      expect(response.status, category).toBe(200);
    }
  });

  it("requires a title", async () => {
    const { route } = await loadRoute();
    expect((await route.PATCH(patch({ ...VALID, title: "  " }), params)).status).toBe(400);
  });

  it("bounds an over-long title", async () => {
    const { route } = await loadRoute();
    const response = await route.PATCH(
      patch({ ...VALID, title: "x".repeat(5000) }),
      params,
    );
    expect(response.status).toBe(400);
  });

  it("bounds list length and drops over-long entries", async () => {
    const { route, trace } = await loadRoute();
    await route.PATCH(
      patch({
        ...VALID,
        keywords: [...Array.from({ length: 200 }, (_, i) => `kw${i}`), "y".repeat(500)],
      }),
      params,
    );

    const keywords = trace.updates[0].keywords as string[];
    expect(keywords.length).toBeLessThanOrEqual(24);
    expect(keywords.every((entry) => entry.length <= 48)).toBe(true);
  });

  it("normalises keywords and tags the way upload does", async () => {
    const { route, trace } = await loadRoute();
    await route.PATCH(
      patch({ ...VALID, keywords: [" Bed Cleaning "], tags: ["  URGENT "] }),
      params,
    );

    expect(trace.updates[0].keywords).toEqual(["bed cleaning"]);
    expect(trace.updates[0].tags).toEqual(["urgent"]);
  });

  it("leaves equipment case alone, as upload does", async () => {
    const { route, trace } = await loadRoute();
    await route.PATCH(patch({ ...VALID, equipment: [" Versa Spa "] }), params);
    expect(trace.updates[0].equipment).toEqual(["Versa Spa"]);
  });
});

/* -------------------------------------------------------------- delete -- */

describe("deleting a video requires manage_videos", () => {
  it("lets a manager delete", async () => {
    const { route, trace } = await loadRoute();
    const response = await route.DELETE(del(), params);
    const payload = (await response.json()) as { deleted: boolean };

    expect(response.status).toBe(200);
    expect(payload.deleted).toBe(true);
    expect(trace.deletes).toBe(1);
  });

  it("refuses Employee", async () => {
    const { route, trace } = await loadRoute({ role: "employee" });
    const response = await route.DELETE(del(), params);

    expect(response.status).toBe(403);
    expect(trace.deletes).toBe(0);
    expect(trace.removedPaths).toEqual([]);
  });

  it("refuses an unauthenticated caller", async () => {
    const { route, trace } = await loadRoute({ role: null });
    expect((await route.DELETE(del(), params)).status).toBe(401);
    expect(trace.deletes).toBe(0);
  });
});

describe("the object path is the server's, not the caller's", () => {
  it("removes the path recorded on the row", async () => {
    const { route, trace } = await loadRoute();
    await route.DELETE(del(), params);

    expect(trace.removedPaths).toEqual([[`${VIDEO_ID}/source.mp4`]]);
  });

  it("reads no path from the request", () => {
    const code = ROUTE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const deleteBody = code.slice(code.indexOf("export async function DELETE"));

    // DELETE parses no body at all, so there is nothing to take a path from.
    expect(deleteBody).not.toContain("parseJsonBody");
    expect(deleteBody).toContain("row.storage_path");
  });

  it("removes nothing when the row never had an object", async () => {
    const { route, trace } = await loadRoute({
      row: row({ status: "pending_upload", storage_path: null }),
    });
    const response = await route.DELETE(del(), params);

    expect(response.status).toBe(200);
    expect(trace.deletes).toBe(1);
    expect(trace.removedPaths).toEqual([]);
  });
});

describe("the row goes first, and cleanup cannot un-delete it", () => {
  it("deletes the row before touching storage", () => {
    const code = ROUTE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const body = code.slice(code.indexOf("export async function DELETE"));

    const rowDelete = body.indexOf("deleteTrainingVideoRow(");
    const objectRemove = body.indexOf(".remove(");

    expect(rowDelete).toBeGreaterThan(-1);
    expect(objectRemove).toBeGreaterThan(rowDelete);
  });

  it("still reports deleted when storage cleanup fails", async () => {
    /*
     * A private orphan beats a visible corpse. The row is gone, so the video
     * IS gone from the library — reporting failure would imply it survived.
     */
    const { route } = await loadRoute({ removeError: { message: "storage unavailable" } });
    const response = await route.DELETE(del(), params);
    const payload = (await response.json()) as {
      deleted: boolean;
      storageCleaned: boolean;
      warning?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.deleted).toBe(true);
    expect(payload.storageCleaned).toBe(false);
    expect(payload.warning).toMatch(/removed from the library/);
  });

  it("names no storage path in the cleanup warning", async () => {
    const { route } = await loadRoute({ removeError: { message: "path /x/y failed" } });
    const text = await (await route.DELETE(del(), params)).text();

    expect(text).not.toContain("source.mp4");
    expect(text).not.toContain(VIDEO_ID);
    expect(text).not.toContain("storage unavailable");
    expect(text).not.toContain("path /x/y");
  });

  it("does NOT claim success when the row deletion fails", async () => {
    const { route, trace } = await loadRoute({
      deleteError: { message: "constraint violation" },
    });
    const response = await route.DELETE(del(), params);
    const text = await response.text();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain('"deleted":true');
    // And the object survives, because the video does.
    expect(trace.removedPaths).toEqual([]);
  });

  it("does not claim success when the row vanished concurrently", async () => {
    const { route, trace } = await loadRoute({ deleteReturns: [] });
    const response = await route.DELETE(del(), params);

    expect(response.status).toBe(404);
    expect(trace.removedPaths).toEqual([]);
  });

  it("404s for a video that does not exist", async () => {
    const { route, trace } = await loadRoute({ row: null });
    expect((await route.DELETE(del(), params)).status).toBe(404);
    expect(trace.deletes).toBe(0);
  });
});

describe("pending and failed records can be cleaned up", () => {
  for (const status of ["pending_upload", "failed"] as const) {
    it(`deletes a ${status} record`, async () => {
      const { route, trace } = await loadRoute({ row: row({ status }) });
      const response = await route.DELETE(del(), params);

      expect(response.status).toBe(200);
      expect(trace.deletes).toBe(1);
      // A recorded path is swept even though the row was never playable.
      expect(trace.removedPaths).toEqual([[`${VIDEO_ID}/source.mp4`]]);
    });
  }

  it("refuses Employee for those too", async () => {
    const { route, trace } = await loadRoute({
      role: "employee",
      row: row({ status: "failed" }),
    });
    expect((await route.DELETE(del(), params)).status).toBe(403);
    expect(trace.deletes).toBe(0);
  });
});

/* ------------------------------------------------------------------ GET -- */

describe("reading one video needs only view_videos", () => {
  it("lets Employee read it", async () => {
    const { route, trace } = await loadRoute({ role: "employee" });
    const response = await route.GET(
      new Request(`https://app.test/api/videos/${VIDEO_ID}`),
      params,
    );

    expect(response.status).toBe(200);
    expect(trace.authorized).toEqual(["view_videos"]);
  });

  it("does not return the storage path", async () => {
    const { route } = await loadRoute({ role: "employee" });
    const text = await (
      await route.GET(new Request(`https://app.test/api/videos/${VIDEO_ID}`), params)
    ).text();

    expect(text).not.toContain("source.mp4");
    expect(text).toContain('"hasCloudAsset":true');
  });
});
