import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * ONE WRITER, ENFORCED (FORM_EDIT_SINGLE_WRITER_ENABLED, QA CONDITIONS 1 AND 3)
 * ============================================================================
 *
 * Read from the source with the TypeScript parser (no pattern matching).
 * Ported from Ask Bubbles (117e33b1): the same scan, the same allow-list —
 * this app's out-of-scope and protected calls are in the same functions, in
 * the same numbers. This app's own sites (the payroll amount's save, the
 * reopen's restore, the draft route's amount lines) are in flag-off branches.
 *
 * CONDITION 1. Every call of a form writer — `applyAssistantRevision`,
 * `saveInstanceValues`, `applyStatedFacts`, `syncCorrectiveActionPlan`,
 * `applyAssistantDraft` — in `src/` (tests excluded) is one of:
 *
 *   - inside `form-write.ts`, the one writer;
 *   - an old call site in its FLAG-OFF branch: the `else` of an `if`, or the
 *     false side of a `? :`, whose condition calls
 *     `formEditSingleWriterEnabled()` (the flag-on side calls the one writer);
 *   - one entry of ALLOW_LIST below — a file, the function the call is in,
 *     the writer, and how many such calls — each with its reason.
 *
 * Anything else fails: a new call site anywhere (a new file, a new function,
 * one more call in an allowed function, or a call outside a flag-off branch).
 * An allow-list entry that no longer matches fails too, so the list cannot go
 * stale.
 *
 * CONDITION 3 (static half). `form-write` is never imported statically
 * outside tests; every `import("./form-write")` sits on the flag-on side of a
 * condition that calls `formEditSingleWriterEnabled()`, so with the flag off
 * the module is never loaded. (The runtime half is
 * `form-edit-single-writer-flags-off.test.ts`.)
 */

const WRITERS = new Set(["applyAssistantRevision", "saveInstanceValues", "applyStatedFacts", "syncCorrectiveActionPlan", "applyAssistantDraft"]);
const FLAG_CALL = "formEditSingleWriterEnabled()";
const ONE_WRITER = "src/lib/forms/form-write.ts";

interface Allowed {
  readonly file: string;
  readonly fn: string;
  readonly writer: string;
  readonly count: number;
  readonly reason: string;
}

const ALLOW_LIST: readonly Allowed[] = [
  {
    file: "src/app/api/forms/instances/[id]/route.ts",
    fn: "PATCH",
    writer: "saveInstanceValues",
    count: 1,
    reason: "The manager's own save from the form card: their typed values, not a chat edit (design: out of scope).",
  },
  {
    file: "src/app/api/forms/instances/[id]/route.ts",
    fn: "PATCH",
    writer: "syncCorrectiveActionPlan",
    count: 1,
    reason: "The same UI save keeps the Action Plan's payroll sentence in step with what the manager saved (out of scope with the save).",
  },
  {
    file: "src/app/api/forms/instances/route.ts",
    fn: "applyCardFacts",
    writer: "applyStatedFacts",
    count: 3,
    reason: "Create: the card's answers stated at creation, written once onto a new, empty form (design: create is step 6).",
  },
  {
    file: "src/lib/forms/chat-revision.ts",
    fn: "reviseActiveForm",
    writer: "applyAssistantRevision",
    count: 1,
    reason:
      "PROTECTED until 2b (Pau's typed yes): the revision's write, which also carries openDraftTurn's write. 2b swaps it for writeRevisionEdits.",
  },
  {
    file: "src/lib/forms/chat-revision.ts",
    fn: "reviseActiveForm",
    writer: "applyAssistantDraft",
    count: 1,
    reason: "PROTECTED: the revision's derived Policy Violated line (the optional second hunk, Q3: not taken).",
  },
  {
    file: "src/lib/forms/chat-revision.ts",
    fn: "reviseActiveForm",
    writer: "syncCorrectiveActionPlan",
    count: 1,
    reason: "PROTECTED: the revision's Action Plan sync (its own write goes through the one writer, path \"plan\", with the flag on).",
  },
];

/**
 * Out of scope in the design and NOT scanned writers, listed so the
 * exemption is explicit: `setFollowUpDate` (the follow-up date's own control,
 * `instances.ts`) and `openEditableDraft` (opens a new draft of a finalized
 * form, `editable-draft.ts`). Neither calls a scanned writer; if either ever
 * did, the scan above would fail like any other new call site.
 */
const OUT_OF_SCOPE = ["setFollowUpDate", "openEditableDraft"] as const;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if ((name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx") && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const FILES = sources("src").map((path) => path.split("\\").join("/"));

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function calledName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

function within(node: ts.Node, container: ts.Node | undefined): boolean {
  return container !== undefined && node.pos >= container.pos && node.end <= container.end;
}

function callsFlag(condition: ts.Node, file: ts.SourceFile): boolean {
  return condition.getText(file).includes(FLAG_CALL);
}

/** The call sits on the flag-OFF side of a condition that calls the flag. */
function inFlagOffBranch(node: ts.Node, file: ts.SourceFile): boolean {
  for (let at = node.parent; at; at = at.parent) {
    if (ts.isConditionalExpression(at) && within(node, at.whenFalse) && callsFlag(at.condition, file)) return true;
    if (ts.isIfStatement(at) && within(node, at.elseStatement) && callsFlag(at.expression, file)) return true;
  }
  return false;
}

/** The call sits on the flag-ON side of a condition that calls the flag. */
function inFlagOnBranch(node: ts.Node, file: ts.SourceFile): boolean {
  for (let at = node.parent; at; at = at.parent) {
    if (ts.isConditionalExpression(at) && within(node, at.whenTrue) && callsFlag(at.condition, file)) return true;
    if (ts.isIfStatement(at) && within(node, at.thenStatement) && callsFlag(at.expression, file)) return true;
  }
  return false;
}

function enclosingFunction(node: ts.Node): string {
  for (let at = node.parent; at; at = at.parent) {
    if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) && at.name) return at.name.getText();
    if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && ts.isVariableDeclaration(at.parent)) return at.parent.name.getText();
  }
  return "<module>";
}

interface Site {
  readonly file: string;
  readonly fn: string;
  readonly writer: string;
  readonly line: number;
  readonly flagOff: boolean;
}

function writerCalls(): Site[] {
  const sites: Site[] = [];
  for (const path of FILES) {
    const text = readFileSync(path, "utf8");
    if (![...WRITERS].some((name) => text.includes(name))) continue;
    const file = parse(path);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = calledName(node);
        if (name && WRITERS.has(name)) {
          sites.push({
            file: path,
            fn: enclosingFunction(node),
            writer: name,
            line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
            flagOff: inFlagOffBranch(node, file),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return sites;
}

describe("QA condition 1: one writer for every form edit", () => {
  const sites = writerCalls();

  it("finds the writers' calls (so the scan reads something)", () => {
    expect(sites.filter((site) => site.file === ONE_WRITER).map((site) => site.writer).sort()).toEqual(
      expect.arrayContaining(["applyAssistantDraft", "applyAssistantRevision", "applyStatedFacts", "saveInstanceValues", "syncCorrectiveActionPlan"]),
    );
    expect(sites.filter((site) => site.flagOff).length).toBeGreaterThan(15);
  });

  it("every call outside form-write.ts is in its flag-off branch or on the allow-list, entry by entry, count by count", () => {
    const rest = sites.filter((site) => site.file !== ONE_WRITER && !site.flagOff);
    const counted = new Map<string, Site[]>();
    for (const site of rest) {
      const key = `${site.file}|${site.fn}|${site.writer}`;
      counted.set(key, [...(counted.get(key) ?? []), site]);
    }
    const unexpected: string[] = [];
    for (const [key, found] of counted) {
      const entry = ALLOW_LIST.find((allowed) => `${allowed.file}|${allowed.fn}|${allowed.writer}` === key);
      if (!entry) unexpected.push(...found.map((site) => `${site.file}:${site.line} ${site.writer} in ${site.fn} — not in a flag-off branch and not allowed`));
      else if (entry.count !== found.length) unexpected.push(`${key}: ${found.length} calls, the allow-list says ${entry.count}`);
    }
    expect(unexpected).toEqual([]);
  });

  it("every allow-list entry still matches, and says why", () => {
    for (const entry of ALLOW_LIST) {
      const found = sites.filter((site) => site.file === entry.file && site.fn === entry.fn && site.writer === entry.writer && !site.flagOff);
      expect(found.length, `${entry.file} ${entry.fn} ${entry.writer}`).toBe(entry.count);
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  it("the out-of-scope writers call no scanned writer", () => {
    for (const name of OUT_OF_SCOPE) expect(sites.filter((site) => site.fn === name)).toEqual([]);
  });

  it("a new call site fails: the same scan over a file with one added call reports it", () => {
    const probe = ts.createSourceFile(
      "src/lib/forms/new-path.ts",
      [
        "export async function newPath(id: string) {",
        "  await saveInstanceValues(id, {}, 'x');",
        "  formEditSingleWriterEnabled() ? await one() : await applyAssistantDraft(id, {}, 'x');",
        "}",
      ].join("\n"),
      ts.ScriptTarget.Latest,
      true,
    );
    const found: { name: string; flagOff: boolean }[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && WRITERS.has(calledName(node) ?? "")) found.push({ name: calledName(node)!, flagOff: inFlagOffBranch(node, probe) });
      ts.forEachChild(node, visit);
    };
    visit(probe);
    expect(found).toEqual([
      { name: "saveInstanceValues", flagOff: false },
      { name: "applyAssistantDraft", flagOff: true },
    ]);
    expect(ALLOW_LIST.some((entry) => entry.file === "src/lib/forms/new-path.ts")).toBe(false);
  });
});

describe("QA condition 3 (static): form-write is loaded only by a guarded `await import()`", () => {
  const isFormWrite = (specifier: string) => specifier === "./form-write" || specifier.endsWith("/forms/form-write");

  it("no file imports it statically, and every import() of it is on the flag-on side, awaited", () => {
    const problems: string[] = [];
    let dynamic = 0;
    for (const path of FILES) {
      if (path === ONE_WRITER || !readFileSync(path, "utf8").includes("form-write")) continue;
      const file = parse(path);
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && isFormWrite(node.moduleSpecifier.text)) {
          problems.push(`${path}: static import`);
        }
        if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && isFormWrite(node.moduleSpecifier.text)) {
          problems.push(`${path}: re-export`);
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const [specifier] = node.arguments;
          if (specifier && ts.isStringLiteral(specifier) && isFormWrite(specifier.text)) {
            dynamic += 1;
            const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
            if (!ts.isAwaitExpression(node.parent)) problems.push(`${path}:${line}: import() not awaited`);
            if (!inFlagOnBranch(node, file)) problems.push(`${path}:${line}: import() not guarded by ${FLAG_CALL}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(problems).toEqual([]);
    expect(dynamic).toBeGreaterThan(15);
  });

  it("the new module holds no regular expression and no phrase list", () => {
    const source = readFileSync(ONE_WRITER, "utf8");
    const file = parse(ONE_WRITER);
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) found.push(node.getText(file));
      if (ts.isNewExpression(node) && node.expression.getText(file) === "RegExp") found.push(node.getText(file));
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(found).toEqual([]);
    expect(source).not.toContain("RegExp(");
  });
});

/*
 * FORM_EDIT_TOOL_IN_STREAM_ENABLED (Step 3): the edit tool's path. Its only
 * write is `writeFormEdits` with path "tool" — no scanned writer (the scan
 * above covers it like every file), and form-write reached only by the
 * guarded import (the test above). No regular expression and no phrase list.
 */
describe("the edit tool's path (FORM_EDIT_TOOL_IN_STREAM_ENABLED) writes only through the one writer", () => {
  const TOOL = "src/lib/forms/form-edit-tool.ts";

  it('calls writeFormEdits once, with path "tool", and no other writer', () => {
    const file = parse(TOOL);
    const calls: string[] = [];
    const paths: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = calledName(node);
        if (name === "writeFormEdits" || (name && WRITERS.has(name))) calls.push(name);
        if (name === "writeFormEdits") {
          const rules = node.arguments[2];
          if (rules && ts.isObjectLiteralExpression(rules)) {
            for (const property of rules.properties) {
              if (ts.isPropertyAssignment(property) && property.name.getText(file) === "path") paths.push(property.initializer.getText(file));
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(calls).toEqual(["writeFormEdits"]);
    expect(paths).toEqual(['"tool"']);
  });

  it("holds no regular expression", () => {
    const file = parse(TOOL);
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) found.push(node.getText(file));
      if (ts.isNewExpression(node) && node.expression.getText(file) === "RegExp") found.push(node.getText(file));
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(found).toEqual([]);
  });
});
