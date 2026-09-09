import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

/**
 * ============================================================================
 * THE PROTOTYPE'S DRAFTING PATH IS GONE, AND STAYS GONE
 * ============================================================================
 *
 * This file used to test `lib/forms/fill-rules.ts` — the guard that decided
 * which fields a model could write, expressed over the prototype's
 * `TemplateField` / `fillRule` shape. Both that module and the route that used
 * it have been removed, so the tests here changed target rather than
 * disappearing: they now assert the removal, and they assert that the endpoint
 * which replaced it derives the three decisions that matter from the SERVER.
 *
 * WHY THE ROUTE WENT INSTEAD OF BEING RE-AUTHORIZED. `POST /api/forms/draft`
 * asked for `create_coaching_form` whatever template it was handed, and took
 * its field list out of the request body. A role that could draft a coaching
 * form could therefore have Claude write the prose of a Disciplinary Plan of
 * Action, over whatever field list the browser chose to send. It also had no
 * callers: everything drafts through `POST /api/forms/instances/[id]/draft`.
 *
 * The equivalent guard for the live path is `enforceResponsibilities` and
 * `AI_WRITABLE` in `responsibility.ts`, over the stored document model, and it
 * is tested in `document.test.ts`.
 */

describe("the prototype drafting path is removed", () => {
  it("has no /api/forms/draft route", () => {
    expect(existsSync("src/app/api/forms/draft/route.ts")).toBe(false);
    expect(existsSync("src/app/api/forms/draft")).toBe(false);
  });

  it("has no fill-rules module", () => {
    expect(existsSync("src/lib/forms/fill-rules.ts")).toBe(false);
  });

  it("leaves no draftForm on the AI provider interface", () => {
    const source = readFileSync("src/lib/ai/types.ts", "utf8");
    // The comment block explaining the removal mentions the name; what must not
    // exist is a member declaration.
    expect(source).not.toMatch(/^\s*draftForm\(/m);
  });

  it.each([
    "src/lib/ai/claude-provider.ts",
    "src/lib/ai/mock-provider.ts",
  ])("%s no longer implements it", (path) => {
    expect(readFileSync(path, "utf8")).not.toContain("draftForm");
  });
});

describe("the drafting endpoint that replaced it takes its decisions from the server", () => {
  const route = readFileSync(
    "src/app/api/forms/instances/[id]/draft/route.ts",
    "utf8",
  );

  it("authorizes through the instance rather than a named permission", () => {
    // `authorizeInstance` resolves the instance, then applies THAT template's
    // own `required_permission` and the form's salon.
    expect(route).toContain("authorizeInstance(request, id");
    // The old failure, spelled out so a regression is unmistakable: no route on
    // the drafting path may name a single template's permission for every form.
    expect(route).not.toContain('"create_coaching_form"');
  });

  it("reads the field list from the pinned template version, not the request", () => {
    expect(route).toContain("loaded.version.document");
    expect(route).toContain("draftableFields(document, variantKey)");
    // A field list arriving in the body is the vulnerability that was removed.
    expect(route).not.toMatch(/body\.fields/);
  });

  it("runs the responsibility guard on what the model returned", () => {
    expect(route).toContain("applyAssistantDraft");
  });

  it("keeps policy-quoting fields fail-closed", () => {
    expect(route).toContain("groundPolicy");
    expect(route).toContain("dropUngroundedPolicy");
  });
});

describe("every unsafe prototype behaviour is gone from live code", () => {
  /*
   * NOT "deprecated" — GONE. Each of these wrote a plausible value where a fact
   * was missing, and a fallback kept "for compatibility" is a fallback that
   * still runs.
   *
   * SCANNED WITH COMMENTS STRIPPED, and over non-test files only. The names
   * still appear in prose — in this file, in `types/index.ts`, in the chat
   * screen — because a removal nobody can find the record of is a removal
   * somebody re-adds. What must not exist is an import, a call or a property
   * access.
   */
  const retired = [
    "buildFormCollection",
    "buildFormDraft",
    "findPendingFormTurn",
    "publishedTemplateKeyFor",
    "PUBLISHED_TEMPLATE_KEY",
    "isFormIntent",
    "detectTemplate(",
    "extractEmployeeName(",
    "pendingFormTemplateId",
    "pendingFormValues",
    "@/lib/forms/chat-flow",
    // Added with the drafting-path removal above.
    "@/lib/forms/fill-rules",
    "applyFillRules",
    "writableFieldIds",
    "fillCheckboxDefaults",
  ];

  function sourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) {
        files.push(...sourceFiles(path));
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        files.push(path);
      }
    }
    return files;
  }

  /** Code only: block comments, JSX comments and line comments removed. */
  function code(path: string): string {
    return readFileSync(path, "utf8")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  const files = sourceFiles("src");

  it("scans a plausible number of files", () => {
    // The guard on the guard: an empty file list would make every assertion
    // below pass without reading anything.
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(retired)("%s appears in no live module", (symbol) => {
    const offenders = files.filter((path) => code(path).includes(symbol));
    expect(offenders, `${symbol} still live in:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("leaves the retired modules deleted", () => {
    expect(existsSync("src/lib/forms/chat-flow.ts")).toBe(false);
    expect(existsSync("src/lib/forms/chat-flow.test.ts")).toBe(false);
  });
});
