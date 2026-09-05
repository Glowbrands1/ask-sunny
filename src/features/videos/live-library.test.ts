import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * IN LIVE MODE THE LIBRARY COMES FROM THE SERVER
 * ============================================================================
 *
 * THE QA FINDING THIS PINS. `videos-screen.tsx` read `useAppStore().videos` and
 * nothing else, so the live library was IndexedDB — per-browser, invisible to
 * colleagues, and unrelated to `training_videos`. The cloud API existed and
 * nothing called it.
 *
 * These are structural assertions because the property is structural: which
 * ARRAY the screen treats as canonical in live mode. Behaviour around it — the
 * fetch, its states — is covered in `use-cloud-videos.test.ts`.
 */

const SCREEN = readFileSync("src/features/videos/videos-screen.tsx", "utf8");
const CODE = SCREEN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the canonical list is chosen by mode", () => {
  it("reads the cloud library through the server hook", () => {
    expect(CODE).toContain("useCloudVideos");
    expect(CODE).toMatch(/const live = !isDemoMode\(\)/);
  });

  it("makes cloud records canonical in live mode and local records canonical in demo", () => {
    expect(CODE).toMatch(/const videos = live \? cloudVideos : localVideos/);
  });

  it("never merges the two into one array", () => {
    // The failure mode this prevents: a list where a playable video and a
    // browser-only record look identical.
    expect(CODE).not.toMatch(/\[\s*\.\.\.cloudVideos\s*,\s*\.\.\.local/);
    expect(CODE).not.toMatch(/localVideos\.concat\(/);
  });

  /**
   * ==========================================================================
   * SEEDED DEMO RECORDS ARE NOT HISTORICAL UPLOADS
   * ==========================================================================
   *
   * The screen used to derive `legacyVideos = live ? localVideos : []` and
   * label them "added before cloud video storage existed". In live mode
   * `localVideos` was DEMO_VIDEOS — seeded content nobody ever uploaded — so
   * the app was asserting false provenance about its own sample data.
   *
   * A `VideoResource` in IndexedDB carries nothing that distinguishes a seed
   * from a genuine prototype upload, so no reliable rule exists. They are
   * therefore not shown at all in live mode, and the QA upload is simply
   * re-uploaded once cloud storage is on.
   */
  it("derives no legacy list from local records in live mode", () => {
    expect(CODE).not.toMatch(/legacyVideos/);
    expect(CODE).not.toMatch(/live \? localVideos/);
  });

  it("uses local records only as the demo library", () => {
    // `localVideos` appears exactly twice: the destructure, and the demo side
    // of the canonical choice.
    expect(CODE.match(/localVideos/g) ?? []).toHaveLength(2);
    expect(CODE).toMatch(/const videos = live \? cloudVideos : localVideos/);
  });

  it("does not write cloud records back into the app store", () => {
    // Caching them in IndexedDB would recreate the per-browser library. Only
    // the app-store MUTATORS are forbidden — `.replace()` on a string is a
    // different thing entirely, which an unscoped match would have caught.
    expect(CODE).not.toContain("addVideo(");
    expect(CODE).not.toContain("updateVideo(");
    expect(CODE).not.toMatch(/storage\.replace\(/);
  });

  it("refreshes the cloud library after a confirmed upload", () => {
    expect(CODE).toMatch(/onDone=\{\(\) => \{[\s\S]*?refreshCloud\(\)/);
  });
});

describe("the live library has real loading and failure states", () => {
  it("says it is loading rather than showing an empty count", () => {
    expect(CODE).toMatch(/cloudState\.status === "loading"/);
    expect(SCREEN).toContain("Loading the video library…");
  });

  it("distinguishes a failed read from an empty library", () => {
    expect(CODE).toMatch(/cloudState\.status === "error"/);
    expect(SCREEN).toContain("this is not an empty library");
  });
});

describe("a cloud row is never described as a browser-local file", () => {
  /**
   * A pending or failed row is a cloud record THIS DEPLOYMENT created. Saying
   * its file is "still only in the browser it was uploaded from" is false about
   * a row that is seconds old, and that is what the single shared notice said
   * for every unplayable record.
   */
  it("shows pending and failed uploads their own wording", () => {
    expect(SCREEN).toContain("Upload has not been completed");
    expect(SCREEN).toContain("Upload failed");
  });

  it("keeps the pre-cloud wording for records with no cloud row at all", () => {
    const detail = CODE.slice(CODE.indexOf("function VideoDetail"));
    expect(detail).toMatch(/cloud === null \?/);
    expect(SCREEN).toContain("created before cloud video storage");
  });

  it("branches the notice on the cloud status rather than showing one paragraph", () => {
    const detail = CODE.slice(CODE.indexOf("function VideoDetail"));
    expect(detail).toMatch(/cloud\.status === "pending_upload"/);
  });

  it("separates uploads needing attention from the library", () => {
    expect(SCREEN).toContain("Uploads needing attention");
    expect(SCREEN).toContain("not visible to viewers");
    expect(CODE).toMatch(/cloudState\.needsAttention/);
  });

  it("marks demo mode as demo", () => {
    expect(SCREEN).toContain("Demo mode.");
    expect(SCREEN).toMatch(/uploads here are local/i);
  });
});

describe("a cloud video's detail comes from the server's own record", () => {
  it("passes the server record rather than reconstructing one", () => {
    expect(CODE).toMatch(/cloudState\.videos\.find\(\(entry\) => entry\.id === activeVideo\.id\)/);
    expect(CODE).toMatch(/cloud=\{/);
  });

  it("decides playability from the server record, not a prototype flag", () => {
    expect(CODE).toMatch(/const playable = cloud\?\.hasCloudAsset === true/);
  });

  it("fabricates nothing for a legacy record", () => {
    const legacy = CODE.slice(CODE.indexOf("function legacyViewOf"));

    // Honest values only: never ready, no file, nothing transcribed.
    expect(legacy).toMatch(/status: "pending_upload"/);
    expect(legacy).toMatch(/hasCloudAsset: false/);
    expect(legacy).toMatch(/mimeType: null/);
    expect(legacy).toMatch(/sizeBytes: null/);
    expect(legacy).toMatch(/transcriptProvider: null/);
    expect(legacy).not.toMatch(/status: "ready"/);
  });

  it("no longer maps any resource into a cloud record", () => {
    // The old `transcriptViewOf` invented `status: "ready"` from a flag.
    expect(CODE).not.toContain("transcriptViewOf");
  });
});

describe("the view counter is withheld rather than shown dead", () => {
  it("shows no Views stat for a cloud record", () => {
    // `view_count` has no increment anywhere in the codebase, so a cloud
    // record would read "0 views" forever.
    expect(CODE).toMatch(/\.\.\.\(cloud\s*\n?\s*\?\s*\[\]/);
  });

  it("has no write path anywhere to justify showing one", () => {
    for (const file of [
      "src/lib/videos/repository.ts",
      "src/app/api/videos/route.ts",
      "src/app/api/videos/[id]/playback/route.ts",
      "src/app/api/videos/[id]/finalize/route.ts",
    ]) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      /*
       * A WRITE, not a declaration. `view_count: number` in the row interface
       * is the column's type; what must not exist is a value being assigned to
       * it in an insert or an update.
       */
      expect(code, file).not.toMatch(/view_count:\s*(\d|view_count|`|\w+\s*\+)/);
      expect(code, file).not.toMatch(/increment/i);
    }
  });
});
