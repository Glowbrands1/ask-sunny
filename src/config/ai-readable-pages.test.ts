import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { READER_PERMISSION } from "@/lib/ai/agent-loop/data-tools";
import { agentLoopTools } from "@/lib/ai/agent-loop/run";
import { rulesBookText } from "@/lib/ai/agent-loop/rules-book";
import { SUNNY_CONFIG } from "@/lib/ai/agent-loop/app-config";

import { AI_READABLE_PAGES, readablePagesLine } from "./ai-readable-pages";

/**
 * Board f039 (QA approved 23 Nov 2026; CLAUDE.md §5): every page under `src/app/(app)` declares the tool that reads it
 * for the AI, or why none does. A new page with no entry fails here, so it can't merge until it says one or the other.
 */

const ROOT = process.cwd();
const APP = join(ROOT, "src", "app", "(app)");
const PACK = join(ROOT, "src", "app", "api", "chat", "replay-pack");

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return pageFiles(path);
    /* A route module with no JSX is page.ts (the HR approval page, a form's own page): a page all the same. */
    return entry === "page.tsx" || entry === "page.ts" ? [path] : [];
  });
}

/** `src/app/(app)/reports/salon-performance/[salon]/page.tsx` → `/reports/salon-performance/[salon]`. */
const routeOf = (file: string) => "/" + relative(APP, file).split(sep).slice(0, -1).join("/");

const PAGES = AI_READABLE_PAGES.filter((page) => page.kind === "page");
const fileOf = (route: string) => {
  const tsx = join(APP, ...route.split("/").filter(Boolean), "page.tsx");
  return existsSync(tsx) ? tsx : join(APP, ...route.split("/").filter(Boolean), "page.ts");
};

/** The gate a page calls first, read from its source. */
function gateOf(source: string): { permission: string; adminConsole: boolean } | "signedIn" | null {
  const match = /require(PagePermission|AdminConsolePage)\("([a-z_]+)"\)|requireAuthenticatedPage\(\)/.exec(source);
  if (!match) return null;
  if (!match[1]) return "signedIn";
  return { permission: match[2], adminConsole: match[1] === "AdminConsolePage" };
}

const caseSources = readdirSync(PACK).filter((entry) => entry.endsWith("-cases.ts")).map((entry) => readFileSync(join(PACK, entry), "utf8"));
const toolSpecs = agentLoopTools(SUNNY_CONFIG) as ReadonlyArray<{ name: string; description: string }>;

describe("the pages the AI can read (board f039)", () => {
  it("every page under src/app/(app) has exactly one entry, and every page entry is a page", () => {
    const routes = pageFiles(APP).map(routeOf).sort();
    const declared = PAGES.map((page) => page.route).sort();
    const missing = routes.filter((route) => !declared.includes(route));
    expect(missing, `these pages have no entry in src/config/ai-readable-pages.ts. Add one: the tool that reads it for the AI, or notReadable with why (CLAUDE.md §5):\n${missing.join("\n")}`).toEqual([]);
    expect(declared.filter((route) => !routes.includes(route)), "an entry names a page that does not exist").toEqual([]);
    expect(new Set(declared).size, "a page has two entries").toBe(declared.length);
  });

  it("an API entry is a route that exists, gated as it says", () => {
    for (const entry of AI_READABLE_PAGES.filter((page) => page.kind === "api")) {
      const file = join(ROOT, "src", "app", ...entry.route.split("/").filter(Boolean), "route.ts");
      expect(existsSync(file), `${entry.route}: no route.ts`).toBe(true);
      expect("signedRequest" in entry.access, `${entry.route}: an API entry names the check its route calls`).toBe(true);
      if ("signedRequest" in entry.access) expect(readFileSync(file, "utf8"), `${entry.route} does not call ${entry.access.signedRequest}`).toContain(`${entry.access.signedRequest}(`);
    }
  });

  it("each entry has a reader or an honest reason, never both", () => {
    for (const entry of AI_READABLE_PAGES) {
      expect(Boolean(entry.reader) !== Boolean(entry.notReadable), `${entry.route}: give a reader or notReadable, not both or neither`).toBe(true);
      if (entry.notReadable) expect(entry.notReadable.trim().length, `${entry.route}: notReadable says why`).toBeGreaterThan(20);
    }
  });

  it("the access an entry declares is the gate its page calls", () => {
    for (const entry of PAGES) {
      const gate = gateOf(readFileSync(fileOf(entry.route), "utf8"));
      if ("signedIn" in entry.access) {
        expect(gate, `${entry.route}: the page does not call requireAuthenticatedPage first`).toBe("signedIn");
      } else if ("permission" in entry.access) {
        expect(gate, `${entry.route}: the page's gate`).toEqual({ permission: entry.access.permission, adminConsole: entry.access.adminConsole === true });
      } else {
        throw new Error(`${entry.route}: a page is gated by a permission or a sign-in`);
      }
    }
  });

  it("a reader is a loop tool that checks the page's own permission, and its replay case is in the pack", () => {
    const names = toolSpecs.map((tool) => tool.name);
    for (const entry of AI_READABLE_PAGES) {
      if (!entry.reader) continue;
      expect(names, `${entry.route}: ${entry.reader.tool} is not one of the loop's tools`).toContain(entry.reader.tool);
      if (entry.kind === "page" && "permission" in entry.access) {
        expect(READER_PERMISSION[entry.reader.tool], `${entry.route}: ${entry.reader.tool} checks a different permission than the page, so the AI would read more or less than the page shows`).toBe(entry.access.permission);
      }
      expect(entry.reader.figures.length, `${entry.route}: name the figures`).toBeGreaterThan(0);
      expect(entry.reader.periods.length, `${entry.route}: name the periods`).toBeGreaterThan(0);
      expect(caseSources.some((source) => source.includes(`"${entry.reader!.replayCase}"`)), `${entry.route}: replay case ${entry.reader.replayCase} is not in the pack`).toBe(true);
    }
  });

  it("each reader tool's handler checks READER_PERMISSION, not a copy of it", () => {
    const dataTools = readFileSync(join(ROOT, "src", "lib", "ai", "agent-loop", "data-tools.ts"), "utf8");
    expect(dataTools).toContain("READER_PERMISSION.read_reviews)");
    expect(dataTools).toContain("READER_PERMISSION.read_stats)");
    expect(dataTools).toContain("READER_PERMISSION.read_hr_approvals)");
    const formRecords = readFileSync(join(ROOT, "src", "lib", "forms", "chat-form-records.ts"), "utf8");
    // Pau, 23 Nov 2026: the handlers read the SAVED matrix (activePermissionMatrix()), not the built-in defaults; they still check the shared constant.
    expect(formRecords.match(/hasPermission\(activePermissionMatrix\(\), actor\.role, FORM_RECORDS_PERMISSION\)/g)?.length, "find_past_forms' reads check Form Monitoring's permission").toBe(2);
  });

  it("the tool descriptions and the rules book name every readable page, and no other", () => {
    const rules = rulesBookText(SUNNY_CONFIG);
    const line = readablePagesLine(AI_READABLE_PAGES)!;
    expect(rules).toContain(line);
    for (const entry of PAGES) {
      if (entry.route.includes("[")) continue;
      if (entry.reader) {
        const description = toolSpecs.find((tool) => tool.name === entry.reader!.tool)!.description;
        expect(description, `${entry.reader.tool}'s description does not name ${entry.title}`).toContain(`${entry.title} (`);
        expect(line).toContain(`${entry.title} (${entry.reader.tool})`);
      } else {
        expect(line, `${entry.title} is not readable, but the rules book says it is`).not.toContain(`${entry.title} (`);
      }
    }
  });
});
