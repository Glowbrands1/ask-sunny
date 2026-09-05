import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * THE LIVE UPLOAD GOES TO THE CLOUD, NOT TO INDEXEDDB
 * ============================================================================
 *
 * THE QA FINDING THIS PINS. The cloud backend was built and the dialog was
 * never pointed at it: `upload-video-dialog.tsx` still called
 * `getStorageProvider().putBlob(...)` in live mode as well as demo, so an
 * uploaded training video's bytes went into the uploader's own browser.
 * Applying the migration would have changed nothing.
 *
 * Three calls, in order, and the third only if the second succeeded.
 */

const DIALOG_SOURCE = readFileSync(
  "src/features/videos/upload-video-dialog.tsx",
  "utf8",
);

interface Trace {
  posted: { url: string; method: string }[];
  uploads: { bucket: string; path: string; token: string }[];
}

let trace: Trace;

beforeEach(() => {
  vi.resetModules();
  trace = { posted: [], uploads: [] };
});

afterEach(() => {
  vi.doUnmock("@/lib/supabase/browser-client");
  vi.unstubAllGlobals();
  vi.resetModules();
});

const CREATED = {
  video: { id: "8f14e45f-ceea-4e78-b2a7-1c1b1a2b3c4d", title: "Bed sanitising" },
  upload: {
    bucket: "training-videos",
    path: "8f14e45f-ceea-4e78-b2a7-1c1b1a2b3c4d/source.mp4",
    token: "signed-upload-token",
  },
};

async function loadUploader(
  options: {
    createStatus?: number;
    createBody?: unknown;
    storageError?: { message: string } | null;
    finalizeStatus?: number;
    failCleanup?: boolean;
  } = {},
) {
  vi.resetModules();

  vi.doMock("@/lib/supabase/browser-client", () => ({
    getSupabaseBrowserClient: () => ({
      storage: {
        from: (bucket: string) => ({
          uploadToSignedUrl: async (path: string, token: string) => {
            trace.uploads.push({ bucket, path, token });
            return { data: null, error: options.storageError ?? null };
          },
        }),
      },
    }),
  }));

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      trace.posted.push({ url, method: init?.method ?? "GET" });

      if (url === "/api/videos") {
        const status = options.createStatus ?? 201;
        return {
          ok: status < 400,
          status,
          json: async () => options.createBody ?? CREATED,
        } as Response;
      }

      if (url.endsWith("/fail-upload")) {
        if (options.failCleanup) throw new Error("cleanup unreachable");
        return { ok: true, status: 200, json: async () => ({ status: "failed" }) } as Response;
      }

      const status = options.finalizeStatus ?? 200;
      return {
        ok: status < 400,
        status,
        json: async () => ({ video: { ...CREATED.video, hasCloudAsset: true } }),
      } as Response;
    }),
  );

  return import("./cloud-upload");
}

function videoFile(size = 5 * 1024 * 1024, type = "video/mp4"): File {
  const file = new File(["x"], "clip.mp4", { type });
  // `File` from a small array reports its real length; the size is what the
  // policy checks, so it is overridden rather than allocating megabytes.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const METADATA = {
  title: "Bed sanitising",
  description: "",
  category: "equipment",
  durationSeconds: 300,
  equipment: [],
  keywords: [],
  tags: [],
};

/* ------------------------------------------------- the dialog's live path -- */

describe("the live dialog no longer writes to browser storage", () => {
  it("routes the live submit through the cloud uploader", () => {
    const code = DIALOG_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );

    expect(code).toContain("uploadTrainingVideo");
    expect(code).toMatch(/const live = !isDemoMode\(\)/);
    expect(code).toMatch(/if \(live\)\s*\{\s*await submitToCloud\(\)/);
  });

  it("keeps putBlob reachable only from the demo branch", () => {
    const code = DIALOG_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    const cloud = code.slice(
      code.indexOf("async function submitToCloud"),
      code.indexOf("function submitToPrototype"),
    );
    const prototype = code.slice(code.indexOf("function submitToPrototype"));

    expect(cloud).not.toContain("putBlob");
    expect(cloud).not.toContain("getStorageProvider");
    expect(cloud).not.toContain("addVideo");
    // The demo path is unchanged and still explicit.
    expect(prototype).toContain("putBlob");
    expect(prototype).toContain("addVideo");
  });
});

/* -------------------------------------------------------- the three calls -- */

describe("the live upload sequence", () => {
  it("creates the record first", async () => {
    const { uploadTrainingVideo } = await loadUploader();
    await uploadTrainingVideo({ file: videoFile(), metadata: METADATA });

    expect(trace.posted[0]).toEqual({ url: "/api/videos", method: "POST" });
  });

  it("uploads with the server's own bucket, path and token", async () => {
    const { uploadTrainingVideo } = await loadUploader();
    await uploadTrainingVideo({ file: videoFile(), metadata: METADATA });

    expect(trace.uploads).toEqual([
      {
        bucket: "training-videos",
        path: "8f14e45f-ceea-4e78-b2a7-1c1b1a2b3c4d/source.mp4",
        token: "signed-upload-token",
      },
    ]);
  });

  it("never sends the bytes through this app", async () => {
    const { uploadTrainingVideo } = await loadUploader();
    await uploadTrainingVideo({ file: videoFile(), metadata: METADATA });

    // Two JSON calls only: create and finalize. The transfer went to Supabase.
    expect(trace.posted).toEqual([
      { url: "/api/videos", method: "POST" },
      {
        url: "/api/videos/8f14e45f-ceea-4e78-b2a7-1c1b1a2b3c4d/finalize",
        method: "POST",
      },
    ]);
  });

  it("finalizes only after the transfer succeeded", async () => {
    const { uploadTrainingVideo } = await loadUploader();
    await uploadTrainingVideo({ file: videoFile(), metadata: METADATA });

    const finalizeIndex = trace.posted.findIndex((entry) =>
      entry.url.endsWith("/finalize"),
    );
    expect(finalizeIndex).toBe(1);
    expect(trace.uploads).toHaveLength(1);
  });

  it("returns the server's confirmed record", async () => {
    const { uploadTrainingVideo } = await loadUploader();
    const video = await uploadTrainingVideo({ file: videoFile(), metadata: METADATA });

    expect(video).toMatchObject({ id: CREATED.video.id, hasCloudAsset: true });
  });
});

/* ---------------------------------------------------------- failure paths -- */

describe("each stage fails distinguishably", () => {
  it("refuses a disallowed type before calling anything", async () => {
    const { uploadTrainingVideo, VideoUploadError } = await loadUploader();

    await expect(
      uploadTrainingVideo({
        file: videoFile(1024, "application/pdf"),
        metadata: METADATA,
      }),
    ).rejects.toMatchObject({ stage: "validation", recordCreated: false });

    expect(trace.posted).toEqual([]);
    expect(VideoUploadError).toBeDefined();
  });

  it("refuses a file over 50 MB before calling anything", async () => {
    const { uploadTrainingVideo } = await loadUploader();

    await expect(
      uploadTrainingVideo({ file: videoFile(52_428_801), metadata: METADATA }),
    ).rejects.toMatchObject({ stage: "validation" });
    expect(trace.posted).toEqual([]);
  });

  it("accepts a file at exactly 50 MB", async () => {
    const { uploadTrainingVideo } = await loadUploader();
    await uploadTrainingVideo({ file: videoFile(52_428_800), metadata: METADATA });

    expect(trace.uploads).toHaveLength(1);
  });

  it("reports a 4xx from create as metadata, with nothing left behind", async () => {
    const { uploadTrainingVideo } = await loadUploader({
      createStatus: 400,
      createBody: { error: "That is not a video category." },
    });

    await expect(
      uploadTrainingVideo({ file: videoFile(), metadata: METADATA }),
    ).rejects.toMatchObject({
      stage: "metadata",
      recordCreated: false,
      message: "That is not a video category.",
    });
    expect(trace.uploads).toEqual([]);
  });

  it("takes recordCreated from the server, not from the status code", async () => {
    /*
     * THE SERVER SAYS WHICH SIDE OF THE INSERT IT FAILED ON. This used to be
     * inferred — any 5xx meant "the row was created and the token failed" —
     * which is wrong for an unreachable database, a rejected insert, or a
     * configuration fault, all of which happen BEFORE any row exists.
     */
    const { uploadTrainingVideo } = await loadUploader({
      createStatus: 502,
      createBody: {
        error:
          "The upload could not be authorized, so this video was recorded as failed. Try uploading it again.",
        code: "upload_authorization_failed",
        stage: "authorization",
        recordCreated: true,
      },
    });

    await expect(
      uploadTrainingVideo({ file: videoFile(), metadata: METADATA }),
    ).rejects.toMatchObject({ stage: "authorization", recordCreated: true });

    expect(trace.uploads).toEqual([]);
    expect(trace.posted.some((entry) => entry.url.endsWith("/finalize"))).toBe(false);
  });

  it("reports a 5xx raised BEFORE the insert as no record at all", async () => {
    // Same status code, opposite meaning. Only the body distinguishes them.
    const { uploadTrainingVideo } = await loadUploader({
      createStatus: 502,
      createBody: {
        error: "The video record could not be created. Nothing was saved — try again.",
        code: "video_record_failed",
        stage: "metadata",
        recordCreated: false,
      },
    });

    await expect(
      uploadTrainingVideo({ file: videoFile(), metadata: METADATA }),
    ).rejects.toMatchObject({ stage: "metadata", recordCreated: false });
  });

  it("claims no record when the server said nothing about one", async () => {
    // The conservative reading: claiming a row that does not exist sends
    // somebody looking for it.
    const { uploadTrainingVideo } = await loadUploader({
      createStatus: 500,
      createBody: { error: "Something went wrong." },
    });

    await expect(
      uploadTrainingVideo({ file: videoFile(), metadata: METADATA }),
    ).rejects.toMatchObject({ stage: "metadata", recordCreated: false });
  });

  it("does not infer record existence from the HTTP status anywhere", () => {
    const code = readFileSync("src/features/videos/cloud-upload.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(code).not.toMatch(/status\s*>=\s*500/);
    expect(code).toContain("payload?.recordCreated === true");
  });

  it("does NOT finalize when the storage transfer fails", async () => {
    const { uploadTrainingVideo } = await loadUploader({
      storageError: { message: "network reset at object/upload/sign/..." },
    });

    await expect(
      uploadTrainingVideo({ file: videoFile(), metadata: METADATA }),
    ).rejects.toMatchObject({ stage: "transfer", recordCreated: true });

    expect(trace.uploads).toHaveLength(1);
    expect(trace.posted.some((entry) => entry.url.endsWith("/finalize"))).toBe(false);
  });

  it("closes the pending row when the transfer fails", async () => {
    /*
     * The server never sees the transfer, so it cannot know the upload died.
     * Without this call the row stayed `pending_upload` forever —
     * indistinguishable from one still in progress.
     */
    const { uploadTrainingVideo } = await loadUploader({
      storageError: { message: "network reset" },
    });

    await expect(
      uploadTrainingVideo({ file: videoFile(), metadata: METADATA }),
    ).rejects.toMatchObject({ stage: "transfer" });

    expect(trace.posted.at(-1)).toEqual({
      url: `/api/videos/${CREATED.video.id}/fail-upload`,
      method: "POST",
    });
  });

  it("still reports the transfer failure when the cleanup call also fails", async () => {
    /*
     * A cleanup that replaced the original error would tell somebody their
     * cleanup failed rather than that their upload did.
     */
    const { uploadTrainingVideo } = await loadUploader({
      storageError: { message: "network reset" },
      failCleanup: true,
    });

    await expect(
      uploadTrainingVideo({ file: videoFile(), metadata: METADATA }),
    ).rejects.toMatchObject({
      stage: "transfer",
      message: expect.stringContaining("could not be uploaded") as unknown as string,
    });
  });

  it("does not surface the storage error's own text", async () => {
    const { uploadTrainingVideo } = await loadUploader({
      storageError: { message: "object/upload/sign/secret-path?token=abc" },
    });

    await expect(
      uploadTrainingVideo({ file: videoFile(), metadata: METADATA }),
    ).rejects.toMatchObject({
      message: expect.not.stringContaining("token=abc") as unknown as string,
    });
  });

  it("reports a finalize failure as its own stage", async () => {
    const { uploadTrainingVideo } = await loadUploader({ finalizeStatus: 409 });

    await expect(
      uploadTrainingVideo({ file: videoFile(), metadata: METADATA }),
    ).rejects.toMatchObject({ stage: "finalize", recordCreated: true });

    expect(trace.uploads).toHaveLength(1);
  });
});

/* ------------------------------------------------------- the key never leaks */

describe("the browser holds no privileged credential", () => {
  it("uses the existing browser client rather than a second implementation", () => {
    const source = readFileSync("src/features/videos/cloud-upload.ts", "utf8");
    expect(source).toContain('from "@/lib/supabase/browser-client"');
    expect(source).not.toContain("createClient(");
    expect(source).not.toContain("SUPABASE_SECRET_KEY");
  });

  it("constructs no storage path of its own", () => {
    const code = readFileSync("src/features/videos/cloud-upload.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(code).toContain("created.upload.path");
    expect(code).not.toContain("storagePathFor");
    expect(code).not.toMatch(/`\$\{.*\}\/source\./);
  });
});
