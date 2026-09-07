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

/**
 * The uploads-needing-attention section, which moved into its own component so
 * its delete control could be tested by RENDERING it — see
 * `uploads-needing-attention.dom.test.tsx`. What the screen decides, which rows
 * reach it and what pressing delete does next, is still asserted here.
 */
const ATTENTION = readFileSync(
  "src/features/videos/uploads-needing-attention.tsx",
  "utf8",
);
const ATTENTION_CODE = ATTENTION.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  "",
);

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
    expect(ATTENTION).toContain("Uploads needing attention");
    expect(ATTENTION).toContain("not visible to viewers");
    expect(CODE).toMatch(/cloudState\.needsAttention/);
    expect(CODE).toMatch(/<UploadsNeedingAttention\s+videos=\{needsAttention\}/);
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

/* ------------------------------------------------------- category-first UX -- */

describe("the library's category structure is visible on the page", () => {
  /**
   * ==========================================================================
   * CHIPS ANSWER "WHAT CAN I FILTER BY", NOT "WHAT IS IN HERE"
   * ==========================================================================
   *
   * Categories were only horizontal filter chips, so a manager could not see
   * that Training holds one video and Cleaning holds none without clicking
   * through seven of them.
   */
  const OVERVIEW = readFileSync("src/features/videos/category-overview.tsx", "utf8");

  it("renders a category overview alongside the chips", () => {
    expect(CODE).toContain("<CategoryOverview");
    expect(OVERVIEW).toContain("Library by category");
  });

  it("lists every canonical category, including the empty ones", () => {
    // Derived from the shared vocabulary rather than a local list, so a new
    // category appears without touching this component.
    expect(OVERVIEW).toContain("VIDEO_CATEGORIES.map");
    expect(OVERVIEW).not.toMatch(/\.filter\(\s*\(?entry\)?\s*=>\s*count/);
  });

  it("shows a count per category, and says zero rather than hiding it", () => {
    expect(OVERVIEW).toMatch(/counts\[entry\.id\] \?\? 0/);
    expect(OVERVIEW).toMatch(/\{count\} \{pluralize\(count, "video"\)\}/);
  });

  it("is navigation as well as information", () => {
    expect(OVERVIEW).toContain("onSelect(selected ? \"all\" : entry.id)");
    expect(OVERVIEW).toContain('aria-pressed={selected}');
  });

  it("counts the whole library, not the filtered view", () => {
    /*
     * A tile reading "0 videos" because a DIFFERENT category is selected would
     * be actively misleading. Search narrows it, because then the question is
     * "what did my search find, and where".
     */
    expect(CODE).toMatch(/const counts = useMemo\(\(\) => \{[\s\S]*?for \(const video of searched\)/);
    expect(CODE).not.toMatch(/for \(const video of filtered\)/);
  });
});

describe("videos are grouped under category headings", () => {
  it("builds one section per category in canonical order", () => {
    expect(CODE).toMatch(/const sections = useMemo/);
    expect(CODE).toMatch(/VIDEO_CATEGORIES\.map\(\(entry\) => entry\.id\)/);
  });

  it("omits empty sections in the All view and keeps them when filtered", () => {
    // Seven empty headings would be a screenful of nothing; a filtered
    // category with none needs an honest "nothing here".
    expect(CODE).toMatch(
      /\.filter\(\(section\) => category !== "all" \|\| section\.videos\.length > 0\)/,
    );
    expect(SCREEN).toContain("No videos in this category yet.");
  });

  it("gives each section a heading and a count", () => {
    expect(CODE).toMatch(/title=\{section\.label\}/);
    expect(CODE).toMatch(/pluralize\(\s*section\.videos\.length/);
  });

  it("re-groups from the server after an edit rather than patching locally", () => {
    /*
     * A category change has to move the card between sections and change two
     * counts. Re-reading the library is both simpler and guaranteed to match
     * what a refresh shows.
     */
    const edit = CODE.slice(CODE.indexOf("<EditVideoDialog"));
    expect(edit).toMatch(/onSaved=\{\(\) => \{[\s\S]*?refreshCloud\(\)/);
  });

  it("sorts newest first within a section", () => {
    expect(CODE).toMatch(/new Date\(b\.uploadedAt\)\.getTime\(\) - new Date\(a\.uploadedAt\)\.getTime\(\)/);
  });
});

/* ------------------------------------------------- live demo truthfulness -- */

describe("live mode makes no demo claims", () => {
  /**
   * The page rendered "Demo content — seeded for this prototype, not real
   * company data" above a real Supabase video, and a Recent Activity list of
   * invented names doing invented things to it. Both were false.
   */
  it("renders the demo note only in demo mode", () => {
    expect(CODE).toMatch(/\{live \? null : <DemoDataNote \/>\}/);
    // Never unconditionally.
    expect(CODE).not.toMatch(/^\s*<DemoDataNote \/>\s*$/m);
  });

  it("renders the demo activity list only in demo mode", () => {
    const activity = CODE.indexOf("DEMO_VIDEO_ACTIVITY.map");
    const guard = CODE.lastIndexOf("{live ? null : (", activity);

    expect(activity).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    // The guard is the nearest wrapper above the list.
    expect(activity - guard).toBeLessThan(1200);
  });

  it("hides the activity section entirely rather than inventing live rows", () => {
    // There is no activity log for `training_videos`; synthesising rows from
    // what the client knows would be the same lie in a new costume.
    expect(CODE).not.toMatch(/cloudState[\s\S]{0,200}activity/i);
    expect(SCREEN).toContain("Recent video activity");
  });

  it("keeps the demo library labelled as demo", () => {
    expect(SCREEN).toContain("Demo mode.");
  });
});

/* -------------------------------------------------------- admin actions -- */

describe("edit and delete are offered only where they are permitted", () => {
  it("puts the card overflow menu behind manage_videos and a cloud record", () => {
    expect(CODE).toMatch(
      /canManage && live && video\.hasCloudAsset === true \? \(\s*<VideoCardActions/,
    );
  });

  it("puts the preview behind a cloud record too", () => {
    // A demo or legacy record has no object to sign.
    expect(CODE).toMatch(
      /live && video\.hasCloudAsset === true \? \(\s*<VideoPreview/,
    );
  });

  it("passes detail-modal handlers only for a manager", () => {
    expect(CODE).toMatch(/onEdit=\{canManage \? \(\) => setEditingId/);
    expect(CODE).toMatch(/onDelete=\{canManage \? \(\) => setDeletingId/);
  });

  it("keeps the action menu outside the card's own button", () => {
    // Nesting an interactive element in a button is invalid markup and makes
    // the menu unreachable by keyboard.
    const card = readFileSync("src/components/video-card.tsx", "utf8");
    const buttonEnd = card.indexOf("</button>");
    const actions = card.indexOf("{actions ?");
    expect(actions).toBeGreaterThan(buttonEnd);
  });

  it("resolves the dialogs' subject from the server's records", () => {
    // Including the admin list, so a pending or failed upload can be deleted.
    expect(CODE).toMatch(/cloudState\.needsAttention\.find/);
    expect(CODE).toMatch(/const editing = cloudRecord\(editingId\)/);
    expect(CODE).toMatch(/const deleting = cloudRecord\(deletingId\)/);
  });

  it("lets an administrator clear a stuck upload, not merely look at one", () => {
    /*
     * THE QA FINDING. `cloudRecord` resolved out of `needsAttention` and the
     * DELETE route accepted a pending or failed row, but the section rendered
     * no control, so neither could be reached: a dead upload was visible and
     * permanent.
     *
     * The row hands its id to `setDeletingId`, which is the SAME path a library
     * card takes — one `DeleteVideoDialog`, confirmed against the video's name,
     * and one refetch afterwards. Not a second, quieter delete.
     */
    expect(CODE).toMatch(/<UploadsNeedingAttention[\s\S]*?onDelete=\{setDeletingId\}/);
    expect(ATTENTION_CODE).toMatch(/onClick=\{\(\) => onDelete\(entry\.id\)\}/);
    // It asks. The request belongs to the confirmation dialog.
    expect(ATTENTION_CODE).not.toContain("fetch(");
  });

  it("renders the section only for a caller the server gave rows to", () => {
    // No permission check in the browser: `needsAttention` is empty unless the
    // server judged the caller may see those rows, and an empty list renders
    // nothing at all rather than an empty heading.
    expect(ATTENTION_CODE).toMatch(/if \(videos\.length === 0\) return null/);
    expect(ATTENTION_CODE).not.toContain("canManage");
  });

  it("confirms a delete by name rather than asking 'are you sure'", () => {
    const dialog = readFileSync("src/features/videos/delete-video-dialog.tsx", "utf8");
    expect(dialog).toMatch(/Delete <span className="font-semibold">/);
    expect(dialog).toContain("{video.title}");
    expect(dialog).toContain("cannot be undone");
  });
});
