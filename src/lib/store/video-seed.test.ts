import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * SEEDED DEMO VIDEOS DO NOT EXIST IN LIVE MODE
 * ============================================================================
 *
 * THE QA FINDING THIS PINS. `AppStoreProvider` seeded `DEMO_VIDEOS` in both
 * modes, hydrated stored videos in both, and persisted to IndexedDB in both.
 * The Videos screen then took every local record in live mode and labelled it
 * "added before cloud video storage existed" — false provenance for sample
 * content nobody uploaded. Those records also reached global search and the
 * Overview counts as though they were the company's real library.
 *
 * Structural assertions, because the property is structural: which array the
 * provider starts from, and whether the live library is ever written to
 * browser storage.
 */

const STORE = readFileSync("src/lib/store/app-store.tsx", "utf8");
const CODE = STORE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the video seed is mode-dependent", () => {
  it("seeds DEMO_VIDEOS only in demo mode", () => {
    expect(CODE).toMatch(/useState<VideoResource\[\]>\(\s*DEMO_MODE \? DEMO_VIDEOS : \[\],?\s*\)/);
    // The unconditional seed that caused the finding.
    expect(CODE).not.toMatch(/useState<VideoResource\[\]>\(DEMO_VIDEOS\)/);
  });

  it("hydrates stored videos only in demo mode", () => {
    expect(CODE).toMatch(/if \(DEMO_MODE && storedVideos\.length > 0\)/);
    expect(CODE).not.toMatch(/^\s*if \(storedVideos\.length > 0\)/m);
  });

  it("persists videos to browser storage only in demo mode", () => {
    const persist = CODE.slice(CODE.indexOf('storage.replace("videos"') - 400);
    const block = persist.slice(0, persist.indexOf('storage.replace("videos"'));
    expect(block).toContain("if (!DEMO_MODE) return;");
  });

  it("follows the rule knowledge documents already follow", () => {
    // Not a new convention — the same one, applied to the collection that was
    // missing it.
    expect(CODE).toMatch(/if \(!DEMO_MODE\) return;\s*\n\s*void storage\.replace\("knowledge_documents"/);
    expect(CODE).toMatch(/if \(!DEMO_MODE\) return;\s*\n\s*void storage\.replace\("videos"/);
  });
});

describe("demo mode is unchanged", () => {
  it("still seeds and still persists", () => {
    expect(CODE).toContain("DEMO_VIDEOS");
    expect(CODE).toContain('storage.replace("videos", videos)');
  });

  it("still resets to the seeded library", () => {
    expect(CODE).toContain("setVideos(DEMO_VIDEOS)");
  });
});
