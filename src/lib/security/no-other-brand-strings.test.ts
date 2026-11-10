import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * NO SIBLING-BRAND WORDING IN THIS APP'S STRINGS
 * ============================================================================
 *
 * QA (10 Nov 2026; the mirror of Ask Bubbles' scan): never copy the sibling company's content into this app. Every
 * string literal, template text and JSX text under `src/` (tests, fixtures, test support and the replay pack aside) is
 * read with the TypeScript parser — comments and regular expressions are not strings — and none may name the sibling
 * company or its products: "Buff City Soap", "BCS", "soap", "bath bomb", "makery", "Bubbles".
 *
 * The files below may name them, each for the reason given. A new hit anywhere else fails: move the wording to this
 * app's own, or add the file here with its reason.
 */
const BANNED = /buff\s?city|bath\s?bombs?|\bsoaps?\b|\bbcs\b|makery|\bbubbles\b/i;

const ALLOWED: Readonly<Record<string, string>> = {
  "src/lib/brand/index.ts": "the planned second-instance brand draft (a config object, not shipped)",
  "src/lib/config/app-switcher.ts": "the switcher's link to the sibling app names it",
  "src/lib/reviews/apify/discovery.ts": "the sibling's name, so its review listings are filtered out",
  "src/lib/reviews/gbp/locations.ts": "the sibling's name, so its review locations are filtered out",
  "src/lib/ai/prompts.ts": "an instruction to the model never to cite the sibling's manual sections",
  "src/lib/ai/full-manual-context.ts": "an instruction to the model to leave the shared manual's sibling sections out",
};

const SKIP_DIR = /(?:^|\/)(?:node_modules|replay-pack|__tests__|__fixtures__|test)(?:\/|$)/;
const SKIP_FILE = /\.test\.tsx?$|test-support\.ts$|\.d\.ts$/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR.test(path)) out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name) && !SKIP_FILE.test(entry.name)) out.push(path);
  }
  return out;
}

function stringsIn(file: string): { line: number; text: string }[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: { line: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    const text =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)
        ? node.text
        : null;
    const inRegExp = node.parent && ts.isNewExpression(node.parent) && node.parent.expression.getText(source) === "RegExp";
    if (text && !inRegExp) found.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("no sibling-brand wording in this app's strings", () => {
  it("names the sibling company and its products only where a file is allowed to", () => {
    const hits = sourceFiles("src")
      .filter((file) => !ALLOWED[file])
      .flatMap((file) => stringsIn(file).filter(({ text }) => BANNED.test(text)).map(({ line, text }) => `${file}:${line}: ${JSON.stringify(text.slice(0, 100))}`));
    expect(hits).toEqual([]);
  });

  it("every allowed file still needs its place on the list", () => {
    const stale = Object.keys(ALLOWED).filter((file) => {
      try {
        return !stringsIn(file).some(({ text }) => BANNED.test(text));
      } catch {
        return true;
      }
    });
    expect(stale).toEqual([]);
  });
});
