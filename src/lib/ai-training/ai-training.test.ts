import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { NAV_SECTIONS } from "@/components/shell/navigation";
import { DEFAULT_PERMISSION_MATRIX, ROLES, canAccessAdminConsole, hasPermission } from "@/lib/permissions";

import { canShowLesson, groupTrackLessons, slugify, visibleCatalog } from "./catalog";
import { aiTrainingEditorEmails, canEditAiTraining } from "./editors";
import { cleanNewModuleTitle, nextModuleName } from "./module-name";
import { detectTable, parseCsv, parseImportFiles } from "./import";
import {
  extractPromptQuotes,
  parseTrainingMarkdown,
  plainText,
  practiceBlockIds,
  rewriteTrainingHref,
  splitSections,
} from "./markdown";
import type { TrainingCatalog } from "./types";

/**
 * AI TRAINING — the JBA AI Training app, rebuilt inside Ask Sunny without its
 * own sign-in page and reached from an "AI TRAINING" tab.
 */

describe("the AI TRAINING tab", () => {
  const item = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.href === "/ai-training");

  it("is in the sidebar, labelled as the client asked", () => {
    expect(item?.label).toBe("AI TRAINING");
    expect(item?.permission).toBe("view_ai_training");
  });

  it("opens for every role — there is no separate sign-in or approval step", () => {
    for (const role of ROLES) expect(hasPermission(DEFAULT_PERMISSION_MATRIX, role, "view_ai_training"), role).toBe(true);
  });

  // Changed on purpose: the client limited editing to four named people (2026-11-19),
  // so the Manage screens check a named list instead of the admin console roles.
  it("is editable by the named editors only, not by role", () => {
    const manage = readFileSync("src/app/(app)/ai-training/manage/page.tsx", "utf8");
    expect(manage).toContain("ensureAiTrainingEditor(identity);");
    expect(manage).not.toContain("requireAdminConsolePage");
    const editor = readFileSync("src/app/(app)/ai-training/manage/lessons/[id]/page.tsx", "utf8");
    expect(editor).toContain("ensureAiTrainingEditor(identity);");
    expect(editor).not.toContain("requireAdminConsolePage");
    const actions = readFileSync("src/features/ai-training/actions.ts", "utf8");
    expect(actions).not.toContain("canAccessAdminConsole");
    expect(actions).toContain("canEditAiTraining(identity)");
  });

  it("matches the editor list by email, ignoring case and spaces, and fails closed", () => {
    const list = aiTrainingEditorEmails(" Ana.Editor@example.com, ben@example.com;cy@example.com ");
    expect(list).toEqual(["ana.editor@example.com", "ben@example.com", "cy@example.com"]);
    expect(canEditAiTraining({ email: "ANA.EDITOR@example.com" }, list)).toBe(true);
    expect(canEditAiTraining({ email: "someone.else@example.com" }, list)).toBe(false);
    expect(canEditAiTraining({ email: "" }, list)).toBe(false);
    expect(canEditAiTraining(null, list)).toBe(false);
    // Unset or empty: nobody edits.
    expect(aiTrainingEditorEmails(undefined)).toEqual([]);
    expect(aiTrainingEditorEmails("")).toEqual([]);
    expect(canEditAiTraining({ email: "ana.editor@example.com" }, aiTrainingEditorEmails(""))).toBe(false);
  });

  it("does not let an admin role edit unless the person is on the list", () => {
    expect(ROLES.filter(canAccessAdminConsole).length).toBeGreaterThan(0);
    expect(canEditAiTraining({ email: "admin.not.listed@example.com" }, ["ana.editor@example.com"])).toBe(false);
  });

  it("checks every Server Function's caller before doing anything", () => {
    const actions = readFileSync("src/features/ai-training/actions.ts", "utf8");
    const exported = actions.split("export async function ").slice(1);
    expect(exported.length).toBeGreaterThan(8);
    for (const body of exported) {
      expect(/await (caller|administrator)\(\)/.test(body), body.slice(0, 40)).toBe(true);
    }
  });
});

const catalog: TrainingCatalog = {
  tracks: [
    { id: "t1", slug: "claude", title: "Claude Training", sortOrder: 1 },
    { id: "t2", slug: "chatgpt", title: "ChatGPT Training", sortOrder: 2 },
  ],
  modules: [
    { id: "m1", trackId: "t2", slug: "m1", title: "Module 1: Basics", sortOrder: 1, adminOnly: false },
    { id: "m2", trackId: "t2", slug: "archive", title: "Archive: Retired Lessons", sortOrder: 9, adminOnly: true },
  ],
  lessons: [
    { id: "l1", trackId: "t1", moduleId: null, slug: "week-2", title: "Week 2", summary: null, weekNumber: 2, sortOrder: 1, status: "published", publishedAt: null },
    { id: "l2", trackId: "t1", moduleId: null, slug: "week-1", title: "Week 1", summary: "Start", weekNumber: 1, sortOrder: 2, status: "published", publishedAt: null },
    { id: "l3", trackId: "t1", moduleId: null, slug: "draft", title: "Draft lesson", summary: null, weekNumber: 3, sortOrder: 3, status: "draft", publishedAt: null },
    { id: "l4", trackId: "t2", moduleId: "m1", slug: "prompts", title: "Prompts", summary: null, weekNumber: null, sortOrder: 1, status: "published", publishedAt: null },
    { id: "l5", trackId: "t2", moduleId: "m2", slug: "old", title: "Old lesson", summary: null, weekNumber: null, sortOrder: 1, status: "published", publishedAt: null },
    { id: "l6", trackId: "t2", moduleId: "gone", slug: "orphan", title: "Orphan", summary: null, weekNumber: null, sortOrder: 2, status: "published", publishedAt: null },
  ],
};

describe("who sees which lesson", () => {
  it("hides drafts, the archive and lessons whose module is missing from staff", () => {
    const staff = visibleCatalog(catalog, false);
    expect(staff.lessons.map((l) => l.id).sort()).toEqual(["l1", "l2", "l4"]);
    expect(staff.modules.map((m) => m.id)).toEqual(["m1"]);
  });

  it("shows administrators everything", () => {
    expect(visibleCatalog(catalog, true).lessons).toHaveLength(6);
    expect(canShowLesson({ moduleId: "m2", status: "draft" }, catalog.modules, true)).toBe(true);
  });

  it("orders a track without modules by lesson number, and groups the rest by module", () => {
    expect(groupTrackLessons(catalog, "t1")[0].lessons.map((l) => l.slug)).toEqual(["week-1", "week-2", "draft"]);
    const chatgpt = groupTrackLessons(visibleCatalog(catalog, false), "t2");
    expect(chatgpt.map((g) => g.module?.title)).toEqual(["Module 1: Basics"]);
  });

  it("searches titles and summaries", () => {
    expect(groupTrackLessons(catalog, "t1", "start")[0].lessons.map((l) => l.id)).toEqual(["l2"]);
  });
});

describe("lesson markdown", () => {
  it("parses the Notion blocks lessons use", () => {
    const md = [
      "# Title",
      '<callout icon="🎓" color="orange_bg">',
      "\t**Goal:** learn *one* thing",
      "</callout>",
      "- one",
      "\t- nested",
      "1. first",
      "- [x] done",
      "> quoted",
      "---",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "```",
      "a prompt",
      "```",
      "<details><summary>More</summary>",
      "hidden",
      "</details>",
    ].join("\n");
    const blocks = parseTrainingMarkdown(md);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading_1",
      "callout",
      "bulleted_list_item",
      "numbered_list_item",
      "to_do",
      "quote",
      "divider",
      "table",
      "code",
      "toggle",
    ]);
    expect(blocks[1].icon).toBe("🎓");
    expect(blocks[1].color).toBe("orange_bg");
    expect(blocks[1].children?.[0].text).toEqual([
      { text: "Goal:", href: null, bold: true },
      { text: " learn ", href: null },
      { text: "one", href: null, italic: true },
      { text: " thing", href: null },
    ]);
    expect(blocks[2].children?.[0].type).toBe("bulleted_list_item");
    expect(blocks[4].checked).toBe(true);
    expect(blocks[7].header).toBe(true);
    expect(blocks[8].code).toBe("a prompt");
    expect(plainText(blocks[9].text)).toBe("More");
  });

  it("numbers blocks per parse, so the server and browser agree", () => {
    expect(parseTrainingMarkdown("a\n\nb").map((b) => b.id)).toEqual(parseTrainingMarkdown("a\n\nb").map((b) => b.id));
  });

  it("offers Copy for quoted prompts only inside a Practice section", () => {
    const blocks = parseTrainingMarkdown(
      ['Intro "Write me a summary of this long email please"', "## 🛠️ Practice", '- Try "Write me a summary of this long email please"', "## Next", "after"].join("\n"),
    );
    const ids = practiceBlockIds(blocks);
    expect(ids.has(blocks[0].id)).toBe(false);
    expect(ids.has(blocks[2].id)).toBe(true);
    expect(ids.has(blocks[4].id)).toBe(false);
    expect(extractPromptQuotes(blocks[2].text!, true).map((q) => q.text)).toEqual(["Write me a summary of this long email please"]);
  });

  it("points the old app's links at AI Training", () => {
    expect(rewriteTrainingHref("/assignments/claude/week-1")).toBe("/ai-training/claude/week-1");
    expect(rewriteTrainingHref("https://jba-ai-training.lovable.app/assignments/chatgpt/x")).toBe("/ai-training/chatgpt/x");
    expect(rewriteTrainingHref("/policy")).toBe("/ai-training?tab=policy");
    expect(rewriteTrainingHref("https://claude.ai")).toBe("https://claude.ai");
  });

  it("splits Best Practices into a tab per section", () => {
    const { intro, sections } = splitSections("Hello\n## One\na\n```\n## not a heading\n```\n## Two\nb");
    expect(intro).toBe("Hello");
    expect(sections.map((s) => s.title)).toEqual(["One", "Two"]);
  });
});

describe("importing the old app's export", () => {
  const T = "11111111-1111-4111-8111-111111111111";
  const M = "22222222-2222-4222-8222-222222222222";
  const L = "33333333-3333-4333-8333-333333333333";

  it("reads CSV with quoted commas, quotes and newlines", () => {
    expect(parseCsv('id,body_md\r\n1,"a, ""b""\nc"\n')).toEqual([{ id: "1", body_md: 'a, "b"\nc' }]);
  });

  it("knows each table by file name or by its columns", () => {
    expect(detectTable("lessons-export.csv", [])).toBe("lessons");
    expect(detectTable("content_pages_rows.csv", [])).toBe("pages");
    expect(detectTable("x.csv", ["id", "track_id", "admin_only"])).toBe("modules");
    expect(detectTable("x.csv", ["id", "slug", "title", "sort_order"])).toBe("tracks");
  });

  it("imports CSV files, keeping ids, and a JSON export the same way", () => {
    const csv = parseImportFiles([
      { name: "tracks.csv", text: `id,slug,title,sort_order,created_at\n${T},claude,Claude Training,1,2026-01-01` },
      { name: "modules.csv", text: `id,track_id,slug,title,sort_order,admin_only\n${M},${T},m1,Module 1: Basics,1,false` },
      { name: "lessons.csv", text: `id,track_id,module_id,slug,title,summary,body_md,week_number,sort_order,status,published_at\n${L},${T},${M},week-1,Week 1,,"# Hi\n- a",1,1,published,2026-02-01T00:00:00Z` },
      { name: "content_pages.csv", text: `key,title,body_md\npolicy,AI Policy,Be careful` },
    ]);
    expect(csv.problems).toEqual([]);
    expect(csv.tracks).toEqual([{ id: T, slug: "claude", title: "Claude Training", sort_order: 1 }]);
    expect(csv.modules[0].admin_only).toBe(false);
    expect(csv.lessons[0]).toMatchObject({ id: L, module_id: M, summary: null, body_md: "# Hi\n- a", week_number: 1, status: "published" });
    expect(csv.pages).toEqual([{ key: "policy", title: "AI Policy", body_md: "Be careful" }]);

    const json = parseImportFiles([
      {
        name: "training-export.json",
        text: JSON.stringify({
          tracks: [{ id: T, slug: "claude", title: "Claude Training", sort_order: 1 }],
          modules: [],
          lessons: [{ id: L, track_id: T, module_id: null, slug: "week-1", title: "Week 1", body_md: "x", status: "draft" }],
          content_pages: [{ key: "best_practices", title: "Best Practices", body_md: "y" }],
        }),
      },
    ]);
    expect(json.problems).toEqual([]);
    expect(json.lessons[0].status).toBe("draft");
    expect(json.pages[0].key).toBe("best_practices");
  });

  it("says what it skipped instead of failing the whole import", () => {
    const parsed = parseImportFiles([
      { name: "tracks.csv", text: `id,slug,title\n${T},claude,Claude` },
      { name: "lessons.csv", text: `id,track_id,slug,title,body_md\nnot-a-uuid,${T},a,A,x\n${L},${M},b,B,y` },
      { name: "notes.csv", text: "foo,bar\n1,2" },
    ]);
    expect(parsed.lessons).toEqual([]);
    expect(parsed.problems.join(" ")).toMatch(/without an id/);
    expect(parsed.problems.join(" ")).toMatch(/its track is not in the export/);
    expect(parsed.problems.join(" ")).toMatch(/Could not tell which table notes\.csv holds/);
  });
});

describe("slugs", () => {
  it("are lowercase words joined by hyphens", () => {
    expect(slugify("Week 4: Writing with Claude!")).toBe("week-4-writing-with-claude");
    expect(slugify("Café prompts")).toBe("cafe-prompts");
    expect(slugify("!!!")).toBe("lesson");
  });
});

describe("creating a module from the lesson editor", () => {
  it("suggests the next module number, not counting the admin-only archive", () => {
    const five = Array.from({ length: 5 }, () => ({ adminOnly: false }));
    expect(nextModuleName([...five, { adminOnly: true }])).toBe("Module 6: ");
    expect(nextModuleName([])).toBe("Module 1: ");
  });

  it("refuses a new module with no name beyond its number", () => {
    expect(() => cleanNewModuleTitle("Module 6: ")).toThrow("Give the new module a name.");
    expect(() => cleanNewModuleTitle("Module 6:")).toThrow("Give the new module a name.");
    expect(() => cleanNewModuleTitle("   ")).toThrow("Give the new module a name.");
    expect(cleanNewModuleTitle("  Module 6: Agents  ")).toBe("Module 6: Agents");
    expect(cleanNewModuleTitle("Prompt library")).toBe("Prompt library");
  });

  it("saves the new module first, then the lesson into it", () => {
    const actions = readFileSync("src/features/ai-training/actions.ts", "utf8");
    const body = actions.slice(actions.indexOf("export async function saveLessonAction"));
    const fn = body.slice(0, body.indexOf("export async function", 10));
    expect(fn).toContain("newModuleTitle");
    expect(fn).toContain("cleanNewModuleTitle(");
    expect(fn.indexOf("saveModule(null,")).toBeGreaterThan(-1);
    expect(fn.indexOf("saveModule(null,")).toBeLessThan(fn.indexOf("saveLesson("));
  });
});

describe("Manage → Lessons", () => {
  it("shows the module controls above the lesson list, where they are easy to find", () => {
    const screen = readFileSync("src/features/ai-training/manage-screen.tsx", "utf8");
    expect(screen.indexOf("<Modules trackId")).toBeGreaterThan(-1);
    expect(screen.indexOf("<Modules trackId")).toBeLessThan(screen.indexOf("groups.map("));
  });
});

describe("publishing a change to the other app", () => {
  const actions = readFileSync("src/features/ai-training/actions.ts", "utf8");
  const fn = (name: string) => {
    const start = actions.indexOf(`export async function ${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    const next = actions.indexOf("export async function", start + 10);
    return actions.slice(start, next === -1 ? undefined : next);
  };

  it.each(["saveLessonAction", "setLessonStatusAction", "saveModuleAction", "savePageAction"])(
    "%s can publish, only when asked, and only after its own save",
    (name) => {
      const body = fn(name);
      expect(body).toContain("publishToOther");
      expect(body).toContain("await administrator()");
      const local = Math.max(body.indexOf("await saveLesson("), body.indexOf("await saveModule("), body.indexOf("await savePage("));
      expect(local).toBeGreaterThan(-1);
      expect(body.indexOf("await publish(identity,")).toBeGreaterThan(local);
    },
  );

  it.each(["deleteLessonAction", "moveLessonAction", "reviewSubmissionAction", "submitLessonResponse", "importTableAction"])(
    "%s never reaches the other app",
    (name) => {
      expect(fn(name)).not.toContain("await publish(");
      expect(fn(name)).not.toContain("publishAfterSave(");
    },
  );
});
