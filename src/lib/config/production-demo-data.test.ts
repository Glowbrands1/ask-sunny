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
 * So the rule asserted here is structural and about the module graph: a
 * production-reachable module may not statically import `data/demo/*`. The
 * seeds are reached through `await import(...)`, through
 * `dynamic(() => import(...))`, or not at all.
 *
 * THREE SUITES, THREE QUESTIONS.
 *   this one                            what the production graph CONTAINS
 *   production-empty-state.dom.test     what a live account SEES
 *   scripts/verify-no-demo-in-bundle    what a built page actually LOADS
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
 * MODULES ALLOWED TO STATICALLY IMPORT `data/demo/*`
 * ============================================================================
 *
 * Only the DEMO CHUNKS: modules that exist to render seeded content and are
 * reached exclusively through a dynamic import. Everything else loads the data
 * on demand or does not touch it.
 *
 * A NEW ENTRY HERE IS A DECISION, NOT A FORMALITY. The second test proves the
 * commitment it makes — that nothing imports the chunk the ordinary way.
 */
const DEMO_CHUNKS = new Set([
  "features/admin/ai-usage-demo-screen.tsx",
  "features/admin/integrations-roadmap-demo.tsx",
  "features/dashboard/overview-activity-demo.tsx",
  "features/resources/resources-demo-screen.tsx",
  "features/reviews/reviews-demo-screen.tsx",
  "features/videos/videos-activity-demo.tsx",
]);

/* ====================================================== the module graph == */

describe("no production module statically imports seeded content", () => {
  it("has no importer outside the demo chunks", () => {
    const offenders: string[] = [];

    for (const file of productionModules()) {
      if (DEMO_CHUNKS.has(file)) continue;
      /*
       * `import type` is erased by the compiler and ships nothing, so it is
       * not an offender — `mock-provider.ts` takes the `DemoAnswer` shape
       * that way on purpose.
       */
      if (/^import\s+(?!type\b)[\s\S]*?from\s+"@\/data\/demo[^"]*";/m.test(read(file))) {
        offenders.push(file);
      }
    }

    /*
     * A FAILURE HERE IS A DECISION REQUEST. Either load the data with
     * `await import(...)` / `dynamic(() => import(...))`, or make the module a
     * demo chunk and add it above — which commits to it being unreachable
     * from the static graph.
     */
    expect(offenders).toEqual([]);
  });

  /**
   * AND THE CHUNKS THEMSELVES ARE ONLY REACHED DYNAMICALLY. One ordinary
   * import of a chunk pulls its seeded payload straight back into the
   * production graph, and the test above would not notice.
   */
  it("reaches every demo chunk only through a dynamic import", () => {
    const reachedStatically: string[] = [];

    for (const chunk of DEMO_CHUNKS) {
      const base = chunk.replace(/\.tsx?$/, "").split("/").pop() as string;
      const staticImport = new RegExp(
        `^import\\s+(?!type\\b)[\\s\\S]*?from\\s+"[^"]*${base}";`,
        "m",
      );

      for (const file of productionModules()) {
        if (DEMO_CHUNKS.has(file)) continue;
        if (staticImport.test(read(file))) {
          reachedStatically.push(`${file} -> ${chunk}`);
        }
      }
    }

    expect(reachedStatically).toEqual([]);
  });

  /** Each chunk is genuinely referenced, so none is dead weight. */
  it.each([...DEMO_CHUNKS])("%s is loaded by a dynamic import somewhere", (chunk) => {
    const base = chunk.replace(/\.tsx?$/, "").split("/").pop() as string;
    const referenced = productionModules().some((file) =>
      new RegExp(`import\\("[^"]*${base}"\\)`).test(read(file)),
    );
    expect(referenced).toBe(true);
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

  it("fetches the seeds only inside a demo branch", () => {
    const load = store.indexOf('await import("@/data/demo")');
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
    "components/shell/jump-to-row.tsx",
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
   * there is a promise the product makes everywhere. It is marked and
   * filtered rather than deleted, because it is genuinely useful in demo.
   */
  it("withholds an unverified quick action from live", () => {
    expect(read("data/quick-actions.ts")).toContain("unverified: true");
    expect(code(read("components/shell/jump-to-row.tsx"))).toContain(
      "!action.unverified || isDemoMode()",
    );
  });
});
