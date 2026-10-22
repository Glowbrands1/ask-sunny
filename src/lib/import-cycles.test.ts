import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * ============================================================================
 * NO IMPORT CYCLES IN THE APPLICATION CODE
 * ============================================================================
 *
 * QA, 22 Oct 2026: a production build answered 500 on /api/chat and the forms
 * routes — "Cannot access … before initialization" — because three modules
 * imported each other and one read an imported constant while loading. Every
 * unit test passed: the test runner loads modules in a different order from the
 * production bundle. A cycle is only safe while nobody reads an imported value
 * at load time, and nothing enforces that, so none are allowed.
 *
 * Runtime imports only: `import type`, `export type` and a list of types alone
 * are erased by the compiler and cannot cycle at run time; `await import()` is
 * deferred and is not followed. Test files and test support are not
 * application code and are skipped.
 */
const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === "test") continue;
      sourceFiles(path, out);
    } else if (/\.(?:ts|tsx)$/.test(name) && !/\.(?:test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out;
}

function resolve(from: string, spec: string, known: ReadonlySet<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = normalize(join(dirname(from), spec));
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

const STATEMENT = /^\s*(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;

function runtimeImports(file: string, known: ReadonlySet<string>): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of source.matchAll(STATEMENT)) {
    if (match[5]) {
      const target = resolve(file, match[5], known);
      if (target) found.push(target);
      continue;
    }
    if (match[2]) continue;
    const names = match[3]!.trim();
    if (names.startsWith("{")) {
      const parts = names.replace(/^\{|\}$/g, "").split(",").map((part) => part.trim()).filter(Boolean);
      if (parts.length > 0 && parts.every((part) => part.startsWith("type "))) continue;
    }
    const target = resolve(file, match[4]!, known);
    if (target) found.push(target);
  }
  return found;
}

function cycles(): string[][] {
  const files = sourceFiles(SRC);
  const known = new Set(files);
  const graph = new Map(files.map((file) => [file, runtimeImports(file, known)]));
  // Tarjan's strongly connected components; any with more than one module is a cycle.
  let next = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  const visit = (node: string) => {
    index.set(node, next);
    low.set(node, next);
    next += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(node, Math.min(low.get(node)!, index.get(target)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(relative(process.cwd(), member));
      } while (member !== node);
      if (component.length > 1) found.push(component.sort());
    }
  };
  for (const file of files) if (!index.has(file)) visit(file);
  return found;
}

describe("application modules", () => {
  it("import each other in no cycle", () => {
    expect(cycles()).toEqual([]);
  });
});
