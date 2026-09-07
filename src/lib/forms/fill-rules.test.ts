import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

import type { TemplateField } from "@/types";
import { applyFillRules, writableFieldIds } from "./fill-rules";

/**
 * ============================================================================
 * REQUIREMENTS 34–36 — WHAT PHASE 2 DELIBERATELY DID NOT CHANGE
 * ============================================================================
 *
 * `chat-flow.ts` held two unrelated things under one name. Phase 2 deleted the
 * prototype's chat-to-form script and KEPT the structural guard that decides
 * which fields a model may write, renaming the file to what it actually is.
 *
 * These tests are carried forward from `chat-flow.test.ts` unchanged in
 * substance, because the guard is unchanged in substance. A rename that quietly
 * dropped signature protection would be the worst possible outcome of a
 * cleanup, and this is what would notice.
 */

function field(over: Partial<TemplateField> & { id: string }): TemplateField {
  return {
    label: over.id,
    type: "text",
    fillRule: "ai_populate",
    required: false,
    section: "Details",
    ...over,
  };
}

const fields: TemplateField[] = [
  field({ id: "details" }),
  field({ id: "manager_note", fillRule: "manager_completes" }),
  field({ id: "employee_signature", type: "signature", fillRule: "signature_never_ai" }),
  // A signature field mismarked as AI-populatable: still never written.
  field({ id: "manager_signature", type: "signature", fillRule: "ai_populate" }),
];

describe("34. the fillRule guard is unchanged", () => {
  it("writes only fields the template marks ai_populate", () => {
    const values = applyFillRules(fields, {
      details: "drafted text",
      manager_note: "model tried to write this",
    });
    expect(values).toEqual({ details: "drafted text" });
  });

  it("never writes a signature field, even one mismarked as AI-populatable", () => {
    const values = applyFillRules(fields, {
      employee_signature: "Jane Kowalski",
      manager_signature: "Dana Reyes",
    });
    expect(values).toEqual({});
  });

  it("drops empty strings rather than blanking a field", () => {
    expect(applyFillRules(fields, { details: "" })).toEqual({});
  });

  it("ignores keys the template does not define", () => {
    expect(applyFillRules(fields, { made_up_field: "x" })).toEqual({});
  });

  it("lists exactly the fields a model may fill", () => {
    expect(writableFieldIds(fields)).toEqual(["details"]);
  });
});

describe("35. the drafting route still reads the guard, from its new home", () => {
  it("imports it rather than re-implementing it", () => {
    const source = readFileSync("src/app/api/forms/draft/route.ts", "utf8");

    expect(source).toContain('from "@/lib/forms/fill-rules"');
    expect(source).toContain("applyFillRules");
    expect(source).toContain("writableFieldIds");
    // The guard runs on the model's OUTPUT, which is the property that makes it
    // structural rather than advisory.
    expect(source).not.toContain("@/lib/forms/chat-flow");
  });
});

describe("36. every unsafe prototype behaviour is gone from live code", () => {
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

  it("leaves the retired module deleted", () => {
    expect(existsSync("src/lib/forms/chat-flow.ts")).toBe(false);
    expect(existsSync("src/lib/forms/chat-flow.test.ts")).toBe(false);
  });
});
