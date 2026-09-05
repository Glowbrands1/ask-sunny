import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PERMISSION_MATRIX } from "@/lib/permissions";

/**
 * ============================================================================
 * WHO MAY UPLOAD, WHO MAY WATCH, AND WHAT THE BROWSER IS TRUSTED WITH
 * ============================================================================
 *
 * The video path has three properties that a hidden button does not provide,
 * so each is asserted against the real permission matrix:
 *
 *   UPLOADING NEEDS `manage_videos`. Employee holds `view_videos` and not
 *   `manage_videos`, so the frontline role can watch and cannot publish.
 *
 *   THE UPLOAD TARGET IS DERIVED, NOT SUPPLIED. A caller naming its own storage
 *   path could overwrite another video's source — or an object in another
 *   bucket entirely.
 *
 *   "UPLOAD SUCCEEDED" IS NOT EVIDENCE. The browser uploads straight to
 *   Supabase, so the server never sees the transfer and has to look in the
 *   bucket before calling a video playable.
 */

const CREATE_SOURCE = readFileSync("src/app/api/videos/route.ts", "utf8");
const PLAYBACK_SOURCE = readFileSync(
  "src/app/api/videos/[id]/playback/route.ts",
  "utf8",
);
const FINALIZE_SOURCE = readFileSync(
  "src/app/api/videos/[id]/finalize/route.ts",
  "utf8",
);
const FAIL_SOURCE = readFileSync(
  "src/app/api/videos/[id]/fail-upload/route.ts",
  "utf8",
);

const ORIGINAL = { ...process.env };
const VIDEO_ID = "8f14e45f-ceea-4e78-b2a7-1c1b1a2b3c4d";

interface Trace {
  authorized: string[];
  signedUploadPaths: string[];
  signedUrlPaths: string[];
  inserted: Record<string, unknown>[];
  updated: Record<string, unknown>[];
  listed: { prefix: string; search: string | undefined }[];
  listedStatuses: string[][];
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

/** A row as the repository would read it back. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID,
    title: "Bed sanitising",
    description: "",
    category: "equipment",
    duration_seconds: 300,
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

/**
 * The routes with a fake identity and a fake Supabase.
 *
 * `role` drives a REAL check against DEFAULT_PERMISSION_MATRIX — the matrix is
 * not faked, because the whole question is what it says about Employee.
 */
async function loadRoutes(
  options: { role?: string | null; row?: Record<string, unknown> | null; objects?: { name: string; metadata: { size: number } }[] } = {},
) {
  vi.resetModules();

  const trace: Trace = {
    authorized: [],
    signedUploadPaths: [],
    signedUrlPaths: [],
    inserted: [],
    updated: [],
    listed: [],
    listedStatuses: [],
  };
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
        return {
          identity: {
            subject: "user-1",
            email: "manager@example.test",
            displayName: "Manager",
            role,
            verified: true,
          },
          permission,
          provider: "supabase",
        };
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
          in: (_column: string, values: string[]) => {
            trace.listedStatuses.push(values);
            return builder;
          },
          order: async () => ({
            // The route filters by status at the database; the fake honours
            // that so a test cannot pass on rows the real query would exclude.
            data:
              stored && trace.listedStatuses.at(-1)?.includes(String(stored.status))
                ? [stored]
                : [],
            error: null,
          }),
          maybeSingle: async () => ({ data: stored, error: null }),
          single: async () => ({ data: { id: VIDEO_ID }, error: null }),
          insert: (values: Record<string, unknown>) => {
            trace.inserted.push(values);
            return builder;
          },
          update: (values: Record<string, unknown>) => {
            trace.updated.push(values);
            /*
             * `update().eq()` is awaited by some callers and chained further by
             * the guarded transition, so the returned object is both a thenable
             * and chainable.
             */
            const afterEq: Record<string, unknown> = {
              eq: () => afterEq,
              select: async () => ({ data: [{ id: VIDEO_ID }], error: null }),
              then: (resolve: (value: { error: null }) => unknown) =>
                resolve({ error: null }),
            };
            return { eq: () => afterEq };
          },
        });
        return builder;
      },
      storage: {
        from: (bucket: string) => ({
          createSignedUploadUrl: async (path: string) => {
            trace.signedUploadPaths.push(`${bucket}:${path}`);
            return { data: { signedUrl: "https://signed.upload", token: "tok", path }, error: null };
          },
          createSignedUrl: async (path: string, ttl: number) => {
            trace.signedUrlPaths.push(`${bucket}:${path}:${ttl}`);
            return { data: { signedUrl: "https://signed.play/object" }, error: null };
          },
          remove: async () => ({ data: null, error: null }),
          list: async (prefix: string, opts?: { search?: string }) => {
            trace.listed.push({ prefix, search: opts?.search });
            return { data: options.objects ?? [{ name: "source.mp4", metadata: { size: 2048 } }], error: null };
          },
        }),
      },
    }),
    __setSupabaseAdmin: () => {},
  }));

  const create = await import("./route");
  const playback = await import("./[id]/playback/route");
  const finalize = await import("./[id]/finalize/route");
  const failUpload = await import("./[id]/fail-upload/route");
  return { create, playback, finalize, failUpload, trace };
}

function post(body: unknown): Request {
  return new Request("https://app.test/api/videos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
    },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  title: "Bed sanitising",
  category: "equipment",
  mimeType: "video/mp4",
  sizeBytes: 5 * 1024 * 1024,
};

/* ------------------------------------------------------------- the matrix -- */

describe("the permission shape the video routes are built around", () => {
  it("Employee may view videos", () => {
    expect(DEFAULT_PERMISSION_MATRIX.employee).toContain("view_videos");
  });

  it("Employee may NOT manage videos", () => {
    expect(DEFAULT_PERMISSION_MATRIX.employee).not.toContain("manage_videos");
  });
});

/* ---------------------------------------------------------------- upload -- */

describe("uploading requires manage_videos", () => {
  it("refuses Employee, who may watch but not publish", async () => {
    const { create, trace } = await loadRoutes({ role: "employee" });
    const response = await create.POST(post(VALID_BODY));

    expect(response.status).toBe(403);
    expect(trace.authorized).toEqual(["manage_videos"]);
    // Nothing was created and no upload capability was minted.
    expect(trace.inserted).toEqual([]);
    expect(trace.signedUploadPaths).toEqual([]);
  });

  it("refuses an unauthenticated caller", async () => {
    const { create, trace } = await loadRoutes({ role: null });
    expect((await create.POST(post(VALID_BODY))).status).toBe(401);
    expect(trace.signedUploadPaths).toEqual([]);
  });

  it("admits a role that holds manage_videos", async () => {
    const { create } = await loadRoutes({ role: "district_manager" });
    expect((await create.POST(post(VALID_BODY))).status).toBe(201);
  });

  it("checks authorization before creating anything", () => {
    const code = CREATE_SOURCE.slice(CREATE_SOURCE.indexOf("export async function POST"));
    const auth = code.indexOf('authorizeRequest(request, "manage_videos")');
    const created = code.indexOf("createPendingTrainingVideo(");
    const signed = code.indexOf("createSignedUploadUrl");

    expect(auth).toBeGreaterThan(-1);
    expect(created).toBeGreaterThan(auth);
    expect(signed).toBeGreaterThan(auth);
  });
});

/* ----------------------------------------------------- the upload target -- */

describe("the browser cannot choose where its file lands", () => {
  it("derives the object path from the row id it just created", async () => {
    const { create, trace } = await loadRoutes();
    await create.POST(post(VALID_BODY));

    expect(trace.signedUploadPaths).toEqual([
      `training-videos:${VIDEO_ID}/source.mp4`,
    ]);
  });

  it("ignores a storagePath the caller invents", async () => {
    const { create, trace } = await loadRoutes();
    await create.POST(
      post({
        ...VALID_BODY,
        storagePath: "../knowledge-documents/policy.pdf",
        path: "../../etc/passwd",
        bucket: "knowledge-documents",
      }),
    );

    expect(trace.signedUploadPaths).toEqual([
      `training-videos:${VIDEO_ID}/source.mp4`,
    ]);
    expect(trace.signedUploadPaths[0]).not.toContain("..");
    expect(trace.signedUploadPaths[0]).not.toContain("knowledge-documents");
  });

  it("never reads a path or bucket out of the request body", () => {
    const code = CREATE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/body\.(storagePath|path|bucket)/);
    expect(code).toContain("storagePathFor(id,");
  });
});

/* -------------------------------------------------------- the file policy -- */

describe("the file policy is enforced on the server", () => {
  it("rejects a disallowed MIME type", async () => {
    const { create, trace } = await loadRoutes();
    const response = await create.POST(
      post({ ...VALID_BODY, mimeType: "application/x-msdownload" }),
    );

    expect(response.status).toBe(400);
    expect(trace.inserted).toEqual([]);
    expect(trace.signedUploadPaths).toEqual([]);
  });

  it("accepts a file at exactly the 50 MB ceiling", async () => {
    const { create } = await loadRoutes();
    const response = await create.POST(post({ ...VALID_BODY, sizeBytes: 52_428_800 }));
    expect(response.status).toBe(201);
  });

  it("rejects 50 MB plus one byte before creating a row or a token", async () => {
    const { create, trace } = await loadRoutes();
    const response = await create.POST(post({ ...VALID_BODY, sizeBytes: 52_428_801 }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/limit is 50 MB/);

    // BEFORE the insert and BEFORE the upload capability. A file the storage
    // API would refuse must never get as far as a pending row.
    expect(trace.inserted).toEqual([]);
    expect(trace.signedUploadPaths).toEqual([]);
  });

  it("rejects a file the old 500 MB ceiling would have let through", async () => {
    const { create, trace } = await loadRoutes();
    const response = await create.POST(
      post({ ...VALID_BODY, sizeBytes: 200 * 1024 * 1024 }),
    );

    expect(response.status).toBe(400);
    expect(trace.inserted).toEqual([]);
    expect(trace.signedUploadPaths).toEqual([]);
  });

  it("requires a title", async () => {
    const { create } = await loadRoutes();
    expect((await create.POST(post({ ...VALID_BODY, title: "  " }))).status).toBe(400);
  });

  /**
   * THE SELECT CONTROL IS NOT A CONSTRAINT ON A REQUEST.
   *
   * `parseCreateRequest` used to accept any non-empty category string, so a
   * crafted request could persist `made_up_category` — a record no filter
   * matches and no label exists for.
   */
  it("rejects a category outside the canonical list", async () => {
    const { create, trace } = await loadRoutes();
    const response = await create.POST(
      post({ ...VALID_BODY, category: "made_up_category" }),
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/not a video category/);

    // Before any row and before any capability.
    expect(trace.inserted).toEqual([]);
    expect(trace.signedUploadPaths).toEqual([]);
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
      const { create } = await loadRoutes();
      const response = await create.POST(post({ ...VALID_BODY, category }));
      expect(response.status, category).toBe(201);
    }
  });

  it("marks the row failed rather than claiming nothing was saved", async () => {
    /*
     * The row is created BEFORE the upload token is minted, so a token failure
     * leaves one behind. Saying "Nothing was saved" was false and left an
     * invisible `pending_upload` row that nothing would ever move on.
     */
    vi.resetModules();
    const local: Record<string, unknown>[] = [];

    vi.doMock("@/lib/auth/server", () => ({
      authorizeRequest: async (_request: Request, permission: string) => ({
        identity: {
          subject: "user-1",
          email: "m@example.test",
          displayName: "Manager",
          role: "admin",
          verified: true,
        },
        permission,
        provider: "supabase",
      }),
    }));

    vi.doMock("@/lib/supabase/server", () => ({
      KNOWLEDGE_BUCKET: "knowledge-documents",
      getSupabaseAdmin: () => ({
        from: () => {
          const builder: Record<string, unknown> = {};
          const chain = () => builder;
          Object.assign(builder, {
            select: chain,
            eq: chain,
            maybeSingle: async () => ({ data: null, error: null }),
            single: async () => ({ data: { id: VIDEO_ID }, error: null }),
            insert: chain,
            update: (values: Record<string, unknown>) => {
              local.push(values);
              return { eq: async () => ({ error: null }) };
            },
          });
          return builder;
        },
        storage: {
          from: () => ({
            // The failure this test is about.
            createSignedUploadUrl: async () => ({
              data: null,
              error: { message: "storage unavailable" },
            }),
          }),
        },
      }),
      __setSupabaseAdmin: () => {},
    }));

    const { POST } = await import("./route");
    const response = await POST(post(VALID_BODY));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(payload.error).toMatch(/recorded as failed/);
    expect(payload.error).not.toMatch(/Nothing was saved/);
    // The orphan row was closed out rather than left pending.
    expect(local).toContainEqual({ status: "failed" });
  });
});

/* ------------------------------------------------------------- finalize -- */

describe("a video is only ready when the object is actually there", () => {
  it("marks it ready with the size the bucket reports, not the client's", async () => {
    const { finalize, trace } = await loadRoutes({
      objects: [{ name: "source.mp4", metadata: { size: 2048 } }],
    });

    const response = await finalize.POST(
      new Request("https://app.test/x", { method: "POST" }),
      { params: Promise.resolve({ id: VIDEO_ID }) },
    );

    expect(response.status).toBe(200);
    expect(trace.updated.at(-1)).toMatchObject({ status: "ready", size_bytes: 2048 });
  });

  it("records a failure when the object is missing, rather than trusting the client", async () => {
    const { finalize, trace } = await loadRoutes({ objects: [] });

    const response = await finalize.POST(
      new Request("https://app.test/x", { method: "POST" }),
      { params: Promise.resolve({ id: VIDEO_ID }) },
    );

    expect(response.status).toBe(409);
    expect(trace.updated.at(-1)).toMatchObject({ status: "failed" });
    expect(trace.updated.map((entry) => entry.status)).not.toContain("ready");
  });

  it("refuses a zero-byte object", async () => {
    const { finalize, trace } = await loadRoutes({
      objects: [{ name: "source.mp4", metadata: { size: 0 } }],
    });

    const response = await finalize.POST(
      new Request("https://app.test/x", { method: "POST" }),
      { params: Promise.resolve({ id: VIDEO_ID }) },
    );

    expect(response.status).toBe(409);
    expect(trace.updated.at(-1)).toMatchObject({ status: "failed" });
  });

  it("requires manage_videos", async () => {
    const { finalize } = await loadRoutes({ role: "employee" });
    const response = await finalize.POST(
      new Request("https://app.test/x", { method: "POST" }),
      { params: Promise.resolve({ id: VIDEO_ID }) },
    );
    expect(response.status).toBe(403);
  });
});

/* -------------------------------------------------------------- playback -- */

describe("playback requires view_videos and yields a signed URL", () => {
  function get() {
    return new Request("https://app.test/api/videos/x/playback");
  }

  it("lets Employee obtain a playback link", async () => {
    const { playback, trace } = await loadRoutes({ role: "employee" });
    const response = await playback.GET(get(), {
      params: Promise.resolve({ id: VIDEO_ID }),
    });

    expect(response.status).toBe(200);
    expect(trace.authorized).toEqual(["view_videos"]);
    expect((await response.json()).url).toBe("https://signed.play/object");
  });

  it("mints the URL server-side, for the stored path, in the videos bucket", async () => {
    const { playback, trace } = await loadRoutes();
    await playback.GET(get(), { params: Promise.resolve({ id: VIDEO_ID }) });

    expect(trace.signedUrlPaths).toEqual([
      `training-videos:${VIDEO_ID}/source.mp4:7200`,
    ]);
  });

  it("refuses an unauthenticated caller with no URL at all", async () => {
    const { playback, trace } = await loadRoutes({ role: null });
    const response = await playback.GET(get(), {
      params: Promise.resolve({ id: VIDEO_ID }),
    });

    expect(response.status).toBe(401);
    expect(trace.signedUrlPaths).toEqual([]);
    expect(await response.text()).not.toContain("signed.play");
  });

  it("refuses a video whose upload never completed", async () => {
    const { playback, trace } = await loadRoutes({
      row: row({ status: "pending_upload", storage_path: null }),
    });
    const response = await playback.GET(get(), {
      params: Promise.resolve({ id: VIDEO_ID }),
    });

    expect(response.status).toBe(404);
    expect(trace.signedUrlPaths).toEqual([]);
  });

  it("says nothing about whether an unknown id exists", async () => {
    const { playback } = await loadRoutes({ row: null });
    const response = await playback.GET(get(), {
      params: Promise.resolve({ id: VIDEO_ID }),
    });
    const payload = (await response.json()) as { error: string };

    // The same wording a not-yet-ready video gets.
    expect(response.status).toBe(404);
    expect(payload.error).toBe("That video does not have a playable file.");
  });

  it("marks the response uncacheable, because the URL is a credential", async () => {
    const { playback } = await loadRoutes();
    const response = await playback.GET(get(), {
      params: Promise.resolve({ id: VIDEO_ID }),
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not proxy the media through this app", () => {
    const code = PLAYBACK_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // A proxy would download or stream the object. This route returns a link.
    expect(code).not.toMatch(/\.download\(/);
    expect(code).not.toMatch(/arrayBuffer|ReadableStream|body:/);
    expect(code).toContain("createSignedUrl");
  });
});

/* ---------------------------------------------------- the key never leaks -- */

describe("the secret key stays on the server", () => {
  it("is never read in a route module", () => {
    for (const source of [CREATE_SOURCE, PLAYBACK_SOURCE, FINALIZE_SOURCE]) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toContain("SUPABASE_SECRET_KEY");
      expect(code).not.toContain("service_role");
    }
  });

  it("is not sent to the browser in a create response", async () => {
    const { create } = await loadRoutes();
    const text = await (await create.POST(post(VALID_BODY))).text();

    expect(text).not.toContain("sb_secret_test");
    expect(text).not.toContain("SUPABASE_SECRET_KEY");
    // The upload capability is a token for one path, not a key.
    const payload = JSON.parse(text) as { upload: { path: string; token: string } };
    expect(payload.upload.path).toBe(`${VIDEO_ID}/source.mp4`);
    expect(payload.upload.token).toBe("tok");
  });

  it("does not return the storage path in the library listing", async () => {
    const { create } = await loadRoutes();
    const response = await create.GET(new Request("https://app.test/api/videos"));
    const payload = (await response.json()) as { videos: Record<string, unknown>[] };

    expect(payload.videos[0]).toHaveProperty("hasCloudAsset", true);
    expect(payload.videos[0]).not.toHaveProperty("storagePath");
    expect(payload.videos[0]).not.toHaveProperty("storage_path");
  });

  it("requires view_videos to list the library", async () => {
    const { create } = await loadRoutes({ role: null });
    expect((await create.GET(new Request("https://app.test/api/videos"))).status).toBe(401);
  });
});

/* ------------------------------------------------------------ transcript -- */

describe("transcript state is honest", () => {
  it("creates a video as not_configured while no provider exists", async () => {
    const { create, trace } = await loadRoutes();
    await create.POST(post(VALID_BODY));

    expect(trace.inserted[0]).toMatchObject({ transcript_status: "not_configured" });
  });

  it("never returns transcript text for a status other than ready", async () => {
    const { create } = await loadRoutes({
      row: row({
        transcript_status: "failed",
        transcript_text: "half a transcript from a failed run",
      }),
    });
    const response = await create.GET(new Request("https://app.test/api/videos"));
    const payload = (await response.json()) as { videos: { transcriptText: unknown }[] };

    expect(payload.videos[0].transcriptText).toBeNull();
    expect(await new Response(JSON.stringify(payload)).text()).not.toContain(
      "half a transcript",
    );
  });
});

/* ------------------------------------------------- the status partition -- */

describe("who receives which rows", () => {
  function libraryRequest() {
    return new Request("https://app.test/api/videos");
  }

  it("asks the database for ready rows only, for everyone", async () => {
    const { create, trace } = await loadRoutes({ role: "employee" });
    await create.GET(libraryRequest());

    // Employee holds view_videos and not manage_videos, so exactly one query.
    expect(trace.listedStatuses).toEqual([["ready"]]);
  });

  it("gives Employee no pending or failed rows at all", async () => {
    const { create } = await loadRoutes({ role: "employee" });
    const response = await create.GET(libraryRequest());
    const payload = (await response.json()) as {
      videos: unknown[];
      needsAttention: unknown[];
    };

    // Not hidden in the browser — never put on the wire.
    expect(payload.needsAttention).toEqual([]);
  });

  it("gives Employee the ready videos", async () => {
    const { create } = await loadRoutes({ role: "employee" });
    const response = await create.GET(libraryRequest());
    const payload = (await response.json()) as { videos: { id: string }[] };

    expect(payload.videos.map((entry) => entry.id)).toEqual([VIDEO_ID]);
  });

  it("additionally queries pending and failed rows for a manager", async () => {
    const { create, trace } = await loadRoutes({ role: "district_manager" });
    await create.GET(libraryRequest());

    expect(trace.listedStatuses).toEqual([["ready"], ["pending_upload", "failed"]]);
  });

  it("returns a pending row to a manager under needsAttention, not the library", async () => {
    const { create } = await loadRoutes({
      role: "district_manager",
      row: row({ status: "pending_upload", storage_path: null }),
    });
    const response = await create.GET(libraryRequest());
    const payload = (await response.json()) as {
      videos: unknown[];
      needsAttention: { id: string; status: string }[];
    };

    expect(payload.videos).toEqual([]);
    expect(payload.needsAttention.map((entry) => entry.status)).toEqual([
      "pending_upload",
    ]);
  });

  it("reads the permission from the server matrix, not from the request", () => {
    const code = CREATE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    expect(code).toContain("DEFAULT_PERMISSION_MATRIX");
    expect(code).toMatch(/context\.identity\.role/);
  });
});

/* ------------------------------------------------- closing a dead upload -- */

describe("a pending upload can be closed out", () => {
  function failRequest() {
    return new Request("https://app.test/x", { method: "POST" });
  }

  it("requires manage_videos", async () => {
    const { failUpload } = await loadRoutes({ role: "employee" });
    const response = await failUpload.POST(failRequest(), {
      params: Promise.resolve({ id: VIDEO_ID }),
    });
    expect(response.status).toBe(403);
  });

  it("moves a pending row to failed", async () => {
    const { failUpload, trace } = await loadRoutes({
      role: "district_manager",
      row: row({ status: "pending_upload" }),
    });

    const response = await failUpload.POST(failRequest(), {
      params: Promise.resolve({ id: VIDEO_ID }),
    });

    expect(response.status).toBe(200);
    expect(trace.updated).toContainEqual({ status: "failed" });
  });

  it("leaves a ready video alone rather than un-publishing it", async () => {
    const { failUpload, trace } = await loadRoutes({ role: "district_manager" });

    const response = await failUpload.POST(failRequest(), {
      params: Promise.resolve({ id: VIDEO_ID }),
    });
    const payload = (await response.json()) as { status: string; changed: boolean };

    expect(payload).toEqual({ status: "ready", changed: false });
    expect(trace.updated).toEqual([]);
  });

  it("accepts no status or path from the caller", () => {
    const code = FAIL_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );

    expect(code).not.toContain("parseJsonBody");
    expect(code).not.toMatch(/body\./);
    expect(code).toContain("getTrainingVideoRow");
  });

  it("expresses the transition as a guarded update, not a read-then-write", () => {
    const repository = readFileSync("src/lib/videos/repository.ts", "utf8");
    const failFn = repository.slice(repository.indexOf("export async function failPendingTrainingVideo"));

    expect(failFn).toMatch(/\.eq\("status", "pending_upload"\)/);
  });
});
