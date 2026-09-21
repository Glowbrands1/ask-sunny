import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * NO SEEDED CONTENT REACHES A LIVE DEPLOYMENT — RENDERED OR DOWNLOADED
 * ============================================================================
 *
 * The product rule, in one line: if it did not come from a real data source or
 * a real user action, it does not appear as real data.
 *
 * THIS SUITE ENFORCES THE STRONGER READING. A first pass added runtime gates,
 * which fixed what a live deployment SHOWS. It did not change what a live
 * deployment DOWNLOADS: `Jane Kowalski`, `conv-seed-1`, `example.com/policies`
 * and a fabricated `$214.62` were all still in production JavaScript, shipped
 * to managers and discarded on arrival. An ES import is all-or-nothing and
 * does not care which branch runs.
 *
 * DYNAMIC IMPORTS WERE NOT ENOUGH EITHER, which is the second lesson. They
 * kept the seeds out of every page's download and still EMITTED them: eleven
 * chunks sat in `.next/static`, fetched by nobody. So the rule asserted here
 * is stronger than "not statically imported" — it is that exactly one module,
 * the demo side of the build-time boundary, may name seeded content at all, in
 * either import form. `next.config.ts` substitutes that module in only for an
 * explicit demo build, so a production build never names it and the bundler
 * never emits what it names.
 *
 * FOUR SUITES, FOUR QUESTIONS.
 *   this one                            what the production graph CONTAINS
 *   demo-boundary.test.ts               what each implementation RETURNS
 *   production-empty-state.dom.test     what a live account SEES
 *   scripts/verify-no-demo-in-bundle    what the build actually EMITS
 */

const SRC = join(process.cwd(), "src");

function read(path: string): string {
  return readFileSync(join(SRC, path), "utf8");
}

/** Comments stripped, so prose about demo mode cannot satisfy a code check. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Every `.ts`/`.tsx` under `src`, excluding the seed data and the tests. */
function productionModules(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.split(/[\\/]/).join("/"))
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => !file.startsWith("data/demo/"))
    .filter((file) => !file.includes(".test."));
}

/**
 * ============================================================================
 * MODULES ALLOWED TO IMPORT `data/demo/*` OR A DEMO SCREEN
 * ============================================================================
 *
 * ONE: `lib/demo/runtime.demo.ts`, the demo side of the build-time boundary.
 * `next.config.ts` substitutes it for `lib/demo/runtime.ts` when a build
 * explicitly asks for the demo, so in a production build nothing imports it
 * and the bundler never emits what it names.
 *
 * The demo-only SCREENS are allowed to import seeded data because they are
 * only ever named by that module. The test below proves it, by checking
 * nothing else in the repository imports them.
 *
 * WHY NOT DYNAMIC IMPORTS ANY MORE. They were the previous design and they
 * worked as far as they go: no production page downloaded a seeded record. But
 * a dynamic import EMITS its module, so eleven chunks carrying Jane Kowalski,
 * `example.com/policies` and a fabricated $214.62 sat in `.next/static`,
 * fetched by nobody. A module nothing imports is a module nothing emits.
 */
const DEMO_ONLY_MODULES = new Set([
  "lib/demo/runtime.demo.ts",
  "features/admin/ai-usage-demo-screen.tsx",
  "features/admin/integrations-roadmap-demo.tsx",
  "features/dashboard/overview-activity-demo.tsx",
  "features/resources/resources-demo-screen.tsx",
  "features/reviews/reviews-demo-screen.tsx",
  "features/videos/videos-activity-demo.tsx",
]);

/** The one module allowed to name the demo-only ones. */
const BOUNDARY = "lib/demo/runtime.demo.ts";

/* ====================================================== the module graph == */

describe("only the demo side of the boundary touches seeded content", () => {
  it("has no other importer of data/demo", () => {
    const offenders: string[] = [];

    for (const file of productionModules()) {
      if (DEMO_ONLY_MODULES.has(file)) continue;
      // Comments stripped: `runtime.ts` legitimately DISCUSSES the dynamic
      // import it replaced, and prose must not read as a dependency.
      const source = code(read(file));
      if (/^import\s+(?!type\b)[\s\S]*?from\s+"@\/data\/demo[^"]*";/m.test(source)) {
        offenders.push(`${file} (static)`);
      }
      if (/import\("@\/data\/demo/.test(source)) {
        offenders.push(`${file} (dynamic)`);
      }
    }

    /*
     * A FAILURE HERE IS A DECISION REQUEST. Add what the module needs to the
     * `DemoRuntime` interface and serve it from both implementations — never
     * reach around the boundary, in either import form.
     */
    expect(offenders).toEqual([]);
  });

  /**
   * AND THE DEMO-ONLY MODULES ARE NAMED BY THE BOUNDARY AND NOTHING ELSE. One
   * import of a demo screen from a production module pulls its seeded payload
   * back into the graph, and the test above would not notice.
   */
  it("reaches every demo-only screen from the boundary alone", () => {
    const reached: string[] = [];

    for (const demoModule of DEMO_ONLY_MODULES) {
      if (demoModule === BOUNDARY) continue;
      const base = demoModule.replace(/\.tsx?$/, "").split("/").pop() as string;
      const named = new RegExp(`from\\s+"[^"]*${base}"|import\\("[^"]*${base}"\\)`);

      for (const file of productionModules()) {
        if (file === BOUNDARY || file === demoModule) continue;
        if (named.test(read(file))) reached.push(`${file} -> ${demoModule}`);
      }
    }

    expect(reached).toEqual([]);
  });

  /** And the boundary genuinely names each of them, so none is dead weight. */
  it.each([...DEMO_ONLY_MODULES].filter((m) => m !== BOUNDARY))(
    "%s is named by the demo boundary",
    (demoModule) => {
      const base = demoModule.replace(/\.tsx?$/, "").split("/").pop() as string;
      expect(read(BOUNDARY)).toContain(base);
    },
  );

  /**
   * THE PRODUCTION SIDE IS WHAT EVERYTHING ELSE IMPORTS, and it must stay
   * empty. `demo-boundary.test.ts` asserts what it RETURNS; this asserts that
   * production modules go through it rather than around it.
   */
  it("routes production modules through the production implementation", () => {
    const consumers = productionModules().filter((file) =>
      /from "@\/lib\/demo\/runtime"/.test(read(file)),
    );
    expect(consumers.length).toBeGreaterThan(5);

    for (const file of consumers) {
      expect(read(file), `${file} must not import the demo side directly`).not.toMatch(
        /from "@\/lib\/demo\/runtime\.demo"/,
      );
    }
  });
});

/* ============================================================ the store == */

describe("the client store seeds nothing it has not fetched", () => {
  const store = code(read("lib/store/app-store.tsx"));

  it("holds no static import of the seeds", () => {
    expect(store).not.toMatch(/^import[\s\S]*?from "@\/data\/demo/m);
  });

  it.each([
    ["documents", "KnowledgeDocument"],
    ["videos", "VideoResource"],
    ["templates", "FormTemplate"],
    ["forms", "GeneratedForm"],
    ["conversations", "ChatConversation"],
  ])("starts %s empty", (_state, type) => {
    expect(store).toMatch(new RegExp(`useState<${type}\\[\\]>\\(\\[\\]\\)`));
  });

  it("asks the boundary for its seeds, only inside a demo branch", () => {
    const load = store.indexOf("demoRuntime.loadSeeds()");
    expect(load).toBeGreaterThan(-1);
    expect(store.slice(load - 400, load)).toContain("if (DEMO_MODE)");
  });

  /**
   * THE WRITE SIDE MATTERS AS MUCH AS THE READ SIDE. Seeded state written to
   * IndexedDB in live mode is read back on the next load as though the user
   * put it there — which is exactly how the seeded conversations survived.
   */
  it("does not persist seeded collections in live mode", () => {
    for (const collection of [
      "knowledge_documents",
      "videos",
      "form_templates",
      "generated_forms",
    ]) {
      const index = store.indexOf(`storage.replace("${collection}"`);
      expect(index, `${collection} should still be persisted`).toBeGreaterThan(-1);
      const effect = store.slice(store.lastIndexOf("useEffect(", index), index);
      expect(effect, `${collection} must be demo-gated`).toContain(
        "if (!DEMO_MODE) return;",
      );
    }
  });

  /**
   * CONVERSATIONS ARE THE DELIBERATE EXCEPTION AND IT IS NARROW. There is no
   * server-side chat history, so a live thread lives in this browser or
   * nowhere. What must not be written is the SEEDED pair, and they are no
   * longer in state to write.
   */
  it("still persists real conversations in live mode", () => {
    const index = store.indexOf('storage.replace("chat_conversations"');
    expect(index).toBeGreaterThan(-1);
    expect(store.slice(store.lastIndexOf("useEffect(", index), index)).not.toContain(
      "if (!DEMO_MODE) return;",
    );
  });

  it("purges seeded records already written to a live browser", () => {
    expect(store).toContain("purgeDemoRecords");
    expect(store).toContain("withoutDemoRecords");
  });

  /**
   * THE CLEANUP IS THE ONE THING THAT STILL NEEDS IDS IN PRODUCTION, and it
   * gets them from a module that carries ids and nothing else.
   */
  it("keeps the purge working without importing the seeds", () => {
    const purge = read("lib/store/purge-demo-records.ts");
    expect(purge).not.toMatch(/from "@\/data\/demo/);
    expect(purge).toContain('from "./demo-record-ids"');
  });
});

/* ========================================================= the screens === */

describe("screens that can render seeded content ask for the mode first", () => {
  it.each([
    "features/resources/resources-screen.tsx",
    "features/admin/ai-usage-screen.tsx",
    "features/admin/integrations-screen.tsx",
    "features/dashboard/overview.tsx",
    "features/knowledge/knowledge-screen.tsx",
    "features/videos/videos-screen.tsx",
  ])("%s consults isDemoMode", (path) => {
    expect(code(read(path)), `${path} must gate on the mode`).toContain("isDemoMode");
  });

  /**
   * AND THE REAL PANELS STAY. Gating is not deleting: Integrations keeps the
   * `/api/health` status, which describes THIS deployment and is the section
   * an administrator came for, plus the storage card whose status is measured
   * rather than declared.
   */
  it("keeps the real service status and storage card on Integrations", () => {
    const source = read("features/admin/integrations-screen.tsx");
    expect(source).toContain("<ServiceStatusPanel />");
    expect(source).toContain("BROWSER_STORAGE_INTEGRATION");
    expect(source).toContain("storageAvailable");
    expect(
      /\{live \? null : \([\s\S]*?<ServiceStatusPanel \/>/.test(source),
      "service status must not sit in a demo-only branch",
    ).toBe(false);
  });
});

/* ============================================== links a manager can click = */

describe("production links are verified links", () => {
  it("ships no placeholder or unverified resource", () => {
    /*
     * Comments stripped: the file's header legitimately discusses the
     * placeholders it exists to replace, and why L10 is not here yet.
     */
    const body = code(read("data/resources.ts"));
    for (const banned of [/example\.com/, /localhost/, /placeholder/i, /lovable\.app/, /preview--/]) {
      expect(body, String(banned)).not.toMatch(banned);
    }
  });

  it("renders the production list in live mode and never the seeded one", () => {
    const screen = code(read("features/resources/resources-screen.tsx"));
    expect(screen).toContain("PRODUCTION_RESOURCES");
    expect(screen).not.toContain("DEMO_RESOURCES");
  });

  /**
   * THE QUICK-ACTIONS ROW RENDERS ON EVERY PAGE, so an unverified destination
   * there is a promise the product makes everywhere — and filtering it at
   * render would still have shipped the URL. It moved behind the boundary
   * instead, so a production build does not contain it.
   */
  it("keeps the unverified quick action out of the production list", () => {
    const productionList = read("data/quick-actions.ts");
    expect(productionList).not.toMatch(/lovable\.app/);
    expect(productionList).not.toMatch(/preview--/);
    expect(code(read("components/shell/jump-to-row.tsx"))).toContain(
      "demoRuntime.quickActions",
    );
  });
});
