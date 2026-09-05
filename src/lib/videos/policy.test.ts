import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ALLOWED_VIDEO_MIME_TYPES,
  checkVideoFile,
  isAllowedVideoMimeType,
  storagePathFor,
  VIDEO_BUCKET,
  VIDEO_LIMITS,
  PLAYBACK_URL_TTL_SECONDS,
} from "./policy";

/**
 * ============================================================================
 * WHAT MAY BECOME A TRAINING VIDEO, AND WHERE ITS BYTES GO
 * ============================================================================
 *
 * Two rules with security consequences, so both are pinned here rather than
 * trusted to the routes that call them:
 *
 *   THE TYPE ALLOWLIST is not `video/*`. That attribute on a file input is a
 *   hint to the file picker and constrains nothing a request can send.
 *
 *   THE OBJECT PATH IS DERIVED, never supplied. A path from a request is an
 *   overwrite primitive and a traversal hazard.
 */

const MB = 1024 * 1024;

describe("the type allowlist is a list, not a wildcard", () => {
  it("accepts the three formats a browser can actually play", () => {
    expect([...ALLOWED_VIDEO_MIME_TYPES]).toEqual([
      "video/mp4",
      "video/webm",
      "video/quicktime",
    ]);
  });

  it("refuses a type that merely starts with video/", () => {
    for (const type of ["video/x-msvideo", "video/mpeg", "video/x-matroska"]) {
      expect(isAllowedVideoMimeType(type)).toBe(false);
      expect(checkVideoFile({ mimeType: type, sizeBytes: MB })).toMatchObject({
        ok: false,
        reason: "unsupported_type",
      });
    }
  });

  it("refuses something that is not a video at all", () => {
    const verdict = checkVideoFile({ mimeType: "application/pdf", sizeBytes: MB });
    expect(verdict).toMatchObject({ ok: false, reason: "unsupported_type" });
  });

  it("normalises case and surrounding whitespace", () => {
    expect(checkVideoFile({ mimeType: "  VIDEO/MP4 ", sizeBytes: MB })).toMatchObject({
      ok: true,
      mimeType: "video/mp4",
    });
  });

  it("refuses an empty type rather than defaulting to one", () => {
    expect(checkVideoFile({ mimeType: "", sizeBytes: MB })).toMatchObject({
      ok: false,
      reason: "unsupported_type",
    });
  });
});

describe("the size ceiling", () => {
  it("accepts a file at the limit", () => {
    expect(
      checkVideoFile({ mimeType: "video/mp4", sizeBytes: VIDEO_LIMITS.maxBytes }),
    ).toMatchObject({ ok: true });
  });

  it("refuses a file one byte over", () => {
    const verdict = checkVideoFile({
      mimeType: "video/mp4",
      sizeBytes: VIDEO_LIMITS.maxBytes + 1,
    });
    expect(verdict).toMatchObject({ ok: false, reason: "too_large" });
    if (!verdict.ok) expect(verdict.message).toMatch(/limit is 500 MB/);
  });

  it("refuses an empty file", () => {
    expect(checkVideoFile({ mimeType: "video/mp4", sizeBytes: 0 })).toMatchObject({
      ok: false,
      reason: "empty",
    });
  });

  it("refuses a size that is not a number", () => {
    expect(checkVideoFile({ mimeType: "video/mp4", sizeBytes: NaN })).toMatchObject({
      ok: false,
      reason: "empty",
    });
  });

  /**
   * THE APPLICATION LIMIT AND THE BUCKET LIMIT MUST BE THE SAME NUMBER.
   *
   * If the application's were larger it would accept a file the storage API
   * then rejects, and the failure would surface halfway through a long upload
   * with nothing useful to say. Read out of the migration rather than restated,
   * so the two cannot drift.
   */
  it("matches the bucket's file_size_limit in the migration", () => {
    const migration = readFileSync(
      "supabase/migrations/20260906001000_training_videos.sql",
      "utf8",
    );
    expect(migration).toContain(String(VIDEO_LIMITS.maxBytes));
  });

  it("declares the same MIME types as the bucket", () => {
    const migration = readFileSync(
      "supabase/migrations/20260906001000_training_videos.sql",
      "utf8",
    );
    const bucketBlock = migration.slice(
      migration.indexOf("insert into storage.buckets"),
      migration.indexOf("on conflict"),
    );
    for (const type of ALLOWED_VIDEO_MIME_TYPES) {
      expect(bucketBlock).toContain(`'${type}'`);
    }
  });
});

describe("the storage path is derived, never supplied", () => {
  const id = "8f14e45f-ceea-4e78-b2a7-1c1b1a2b3c4d";

  it("is a pure function of the row id and the type", () => {
    expect(storagePathFor(id, "video/mp4")).toBe(`${id}/source.mp4`);
    expect(storagePathFor(id, "video/webm")).toBe(`${id}/source.webm`);
    expect(storagePathFor(id, "video/quicktime")).toBe(`${id}/source.mov`);
  });

  it("refuses anything that is not a UUID", () => {
    for (const bad of [
      "../knowledge-documents/policy",
      "../../etc/passwd",
      "not-a-uuid",
      "",
      "8f14e45f-ceea-4e78-b2a7-1c1b1a2b3c4d/../other",
    ]) {
      expect(() => storagePathFor(bad, "video/mp4")).toThrow(/must be a UUID/);
    }
  });

  it("cannot produce a path that escapes its own folder", () => {
    const path = storagePathFor(id, "video/mp4");
    expect(path).not.toContain("..");
    expect(path.startsWith(`${id}/`)).toBe(true);
  });

  it("targets the videos bucket, not the knowledge or reporting one", () => {
    expect(VIDEO_BUCKET).toBe("training-videos");
    expect(VIDEO_BUCKET).not.toBe("knowledge-documents");
    expect(VIDEO_BUCKET).not.toBe("reporting-sources");
  });
});

describe("the playback link lives long enough to watch a video", () => {
  it("outlasts a long training video with room to spare", () => {
    // The library's longest clips run about twenty minutes, and a viewer may
    // pause. An hour would be tight; two is comfortable.
    expect(PLAYBACK_URL_TTL_SECONDS).toBeGreaterThanOrEqual(60 * 60);
    // And is still far short of "may as well have made the bucket public".
    expect(PLAYBACK_URL_TTL_SECONDS).toBeLessThanOrEqual(24 * 60 * 60);
  });
});
