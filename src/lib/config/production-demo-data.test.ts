import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * NO SEEDED CONTENT REACHES A LIVE DEPLOYMENT
 * ============================================================================
 *
 * The product rule, in one line: if it did not come from a real data source or
 * a real user action, it does not appear as real data.
 *
 * ============================================================================
 * WHY THIS SUITE READS SOURCE FILES
 * ============================================================================
 *
 * Every leak this was written after had the same shape — a module imported
 * something from `data/demo/` and rendered it without asking `isDemoMode()`.
 * Not one of them was a logic error a unit test would have caught; each was an
 * ABSENT CONDITION, and there is no value to assert on an absent condition.
 *
 * A DOM test per screen would also not have caught them, because a DOM test
 * renders the screen in whichever mode its mocks happen to set, and the mode
 * was exactly what nobody was thinking about. What is actually being asserted
 * is structural: a module that reaches for seeded content must also reach for
 * the gate.
 *
 * SO THE ALLOWLIST BELOW IS THE REVIEW. Adding a new `DEMO_*` import to a
 * production-reachable module fails this suite, and the two ways to pass are
 * to gate it or to say here why it needs no gate. Both are deliberate acts,
 * which is the whole point — the leaks got in because nothing made anybody
 * decide.
 */

const SRC = join(process.cwd(), "src");

function read(path: string): string {
  return readFileSync(join(SRC, path), "utf8");
}

/** Comments stripped, so prose about demo mode cannot satisfy a code check. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/* ======================================================= the store seeds == */

describe("the client store seeds nothing in live mode", () => {
  const store = code(read("lib/store/app-store.tsx"));

  /**
   * ALL FIVE COLLECTIONS, AND FOUR OF THEM ARE NEW.
   *
   * `videos` was the only one guarded. `documents` seeded the Knowledge Base
   * and the Ask band's document count on first paint; `forms` reached Global
   * Search as fabricated coaching records for invented employees; `templates`
   * rendered nowhere and was still written to disk; `conversations` seeded the
   * chat history sidebar with two invented threads.
   */
  it.each([
    "DEMO_KNOWLEDGE_DOCUMENTS",
    "DEMO_VIDEOS",
    "DEMO_FORM_TEMPLATES",
    "DEMO_GENERATED_FORMS",
    "DEMO_CONVERSATIONS",
  ])("%s is only used behind DEMO_MODE", (constant) => {
    /*
     * Every use of the constant in the initial-state position reads
     * `DEMO_MODE ? X : []`. Asserted as a pattern rather than by counting
     * occurrences, so reordering the declarations does not break it.
     */
    const uses = [...store.matchAll(new RegExp(`${constant}`, "g"))];
    expect(uses.length, `${constant} should still be used`).toBeGreaterThan(0);

    const guarded = new RegExp(`DEMO_MODE \\? ${constant} : \\[\\]`);
    const imported = new RegExp(`^\\s*${constant},?$`, "m");
    // Either it appears in a guarded ternary, or it is only the import line.
    const occurrencesOutsideImport = uses.length - (imported.test(store) ? 1 : 0);
    expect(
      guarded.test(store),
      `${constant} must be seeded as DEMO_MODE ? ${constant} : []`,
    ).toBe(true);
    expect(occurrencesOutsideImport).toBeGreaterThan(0);
  });

  /**
   * THE WRITE SIDE MATTERS AS MUCH AS THE READ SIDE. Seeded state written to
   * IndexedDB in live mode is read back on the next load as though the user
   * put it there — which is exactly how the seeded conversations survived.
   */
  it("does not persist seeded collections in live mode", () => {
    for (const collection of ["knowledge_documents", "videos", "form_templates", "generated_forms"]) {
      const index = store.indexOf(`storage.replace("${collection}"`);
      expect(index, `${collection} should still be persisted somewhere`).toBeGreaterThan(-1);
      const effect = store.slice(store.lastIndexOf("useEffect(", index), index);
      expect(effect, `${collection} persist effect must be demo-gated`).toContain(
        "if (!DEMO_MODE) return;",
      );
    }
  });

  /**
   * CONVERSATIONS ARE THE DELIBERATE EXCEPTION AND THE EXCEPTION IS NARROW.
   * There is no server-side chat history, so a live thread lives in this
   * browser or nowhere. What must not be written is the SEEDED pair, and they
   * are no longer in state to write.
   */
  it("still persists real conversations in live mode", () => {
    /*
     * Sliced from the effect's OWN `useEffect(` back-boundary rather than a
     * fixed byte window — a fixed window reached back into the previous
     * effect and read its guard as this one's.
     */
    const index = store.indexOf('storage.replace("chat_conversations"');
    expect(index).toBeGreaterThan(-1);
    const effectStart = store.lastIndexOf("useEffect(", index);
    expect(store.slice(effectStart, index)).not.toContain("if (!DEMO_MODE) return;");
  });

  it("purges seeded records already written to a live browser", () => {
    expect(store).toContain("purgeDemoRecords");
    expect(store).toContain("withoutDemoRecords");
  });
});

/* ================================================ the production screens == */

describe("screens that render seeded content ask for the mode first", () => {
  it.each([
    ["features/resources/resources-screen.tsx", "DEMO_RESOURCES"],
    ["features/admin/ai-usage-screen.tsx", "DEMO_AI_USAGE"],
    ["features/admin/integrations-screen.tsx", "DEMO_INTEGRATIONS"],
    ["features/dashboard/overview.tsx", "DEMO_RECENT_ACTIVITY"],
    ["features/knowledge/knowledge-screen.tsx", "DemoDataNote"],
    ["features/videos/videos-screen.tsx", "DemoDataNote"],
  ])("%s consults isDemoMode", (path, marker) => {
    const source = read(path);
    expect(source, `${path} should still render ${marker}`).toContain(marker);
    expect(code(source), `${path} must gate on the mode`).toContain("isDemoMode");
  });

  /**
   * AND THE REAL PANELS STAY. Gating is not deleting: the Integrations screen
   * must keep the `/api/health` service status, which describes THIS
   * deployment and is the section an administrator actually came for.
   */
  it("keeps the real service-status panel on Integrations", () => {
    const source = read("features/admin/integrations-screen.tsx");
    expect(source).toContain("<ServiceStatusPanel />");
    const gatedOff = /\{live \? null : \([\s\S]*?<ServiceStatusPanel \/>/.test(source);
    expect(gatedOff, "service status must not be inside a demo-only branch").toBe(false);
  });
});

/* ============================================ nothing new sneaks back in == */

/**
 * Modules allowed to import from `data/demo/` without a mode gate, and why.
 *
 * TAXONOMIES AND LABELS ARE NOT DATA. `KNOWLEDGE_CATEGORIES`,
 * `VIDEO_CATEGORY_LABEL`, `ANSWER_MODE_LABEL`, `DOCUMENT_STATUS_LABEL` and
 * `DASHBOARD_QUICK_ACTIONS` are vocabulary and navigation — they describe the
 * product's own structure and state nothing about a salon, a person or a
 * figure. They live under `data/demo/` for historical reasons, which is a
 * filing problem rather than a truthfulness one.
 *
 * THE DEMO-ONLY MODULES are the mock provider, the demo auth provider and the
 * local knowledge provider. Each is only ever constructed in demo mode, by
 * `getAIProvider` / `getAuthProvider` / `getKnowledgeProvider`, and the
 * provider-selection suite already pins that.
 */
const ALLOWED_UNGATED = new Set([
  // Vocabulary and labels.
  "app/api/knowledge/upload/route.ts",
  "components/shell/global-search.tsx",
  "components/shell/jump-to-row.tsx",
  "components/source-card.tsx",
  "features/chat/composer.tsx",
  "features/chat/context-panel.tsx",
  "features/chat/message-bubble.tsx",
  "features/chat/chat-screen.tsx",
  "features/dashboard/answer-sheet.tsx",
  "features/knowledge/document-detail.tsx",
  "features/knowledge/document-status.tsx",
  "features/knowledge/upload-dialog.tsx",
  "features/videos/upload-video-dialog.tsx",
  // Constructed only in demo mode; see the provider-selection suite.
  "lib/ai/mock-provider.ts",
  "lib/auth/demo-provider.ts",
  "lib/knowledge/providers/local.ts",
  "lib/session/session-context.tsx",
  // Gated internally, and asserted by name above.
  "features/admin/users-screen.tsx",
  "features/reviews/reviews-demo-screen.tsx",
  /*
   * THE ONE MODULE THAT IMPORTS THE SEEDS IN ORDER TO DELETE THEM. It reads
   * the constants for their ids and renders nothing; gating it on demo mode
   * would disable the cleanup in precisely the mode that needs it. Its caller
   * in `app-store.tsx` is what checks the mode.
   */
  "lib/store/purge-demo-records.ts",
]);

describe("every production module importing seeded content is accounted for", () => {
  it("has no ungated importer that this suite has not reviewed", () => {
    const files = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .map((entry) => entry.split(/[\\/]/).join("/"))
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => !file.startsWith("data/demo/"))
      .filter((file) => !file.includes(".test."));

    const unreviewed: string[] = [];

    for (const file of files) {
      const source = read(file);
      if (!/from "@\/data\/demo/.test(source)) continue;
      if (ALLOWED_UNGATED.has(file)) continue;
      /*
       * EITHER SPELLING OF THE GATE COUNTS. `isDemoMode()` is the module-level
       * read; `demoMode` is the same answer handed down by `useSession()`,
       * which is what a component inside the provider should use. The login
       * screen and the user menu both take the second, correctly.
       */
      const body = code(source);
      if (body.includes("isDemoMode") || /\bdemoMode\b/.test(body)) continue;
      unreviewed.push(file);
    }

    /*
     * A FAILURE HERE IS NOT A BUG REPORT, IT IS A DECISION REQUEST. Either the
     * new importer renders seeded content and needs `isDemoMode()`, or it
     * imports a label and belongs in ALLOWED_UNGATED with a line saying so.
     */
    expect(unreviewed).toEqual([]);
  });
});

/* ==================================================== the resources list == */

describe("production resources are real links", () => {
  const source = read("data/resources.ts");

  it("contains no placeholder URLs", () => {
    // Comments stripped: the header legitimately discusses the placeholders
    // this file exists to replace.
    const body = code(source);
    expect(body).not.toMatch(/example\.com/);
    expect(body).not.toMatch(/localhost/);
    expect(body).not.toMatch(/placeholder/i);
  });

  it("keeps the one link the app already ships", () => {
    expect(source).toContain("leadership-sync-tool");
  });

  it("is what the Resources screen renders in live mode", () => {
    const screen = code(read("features/resources/resources-screen.tsx"));
    expect(screen).toContain("live ? PRODUCTION_RESOURCES : DEMO_RESOURCES");
  });
});
