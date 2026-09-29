import { parse, parseFragment } from "parse5";

/**
 * ============================================================================
 * NARROW HTML READING — Woven's pages are parsed, never trusted or executed
 * ============================================================================
 *
 * Woven's detail pages and DataTables cells are HTML. They are parsed with a
 * spec-compliant parser (parse5) and read for exactly the attributes, text and
 * inline variables `contract.ts` names. Nothing is rendered, no script runs,
 * and markup is never passed on as HTML: only extracted text leaves this file.
 *
 * Inline page variables (`var mPolicyAttachments = [...]`) are read as JSON
 * literals by bracket matching. A value that is not plain JSON is a parse
 * failure, never an `eval`.
 */

interface Node {
  nodeName: string;
  parentNode?: Node | null;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
  content?: Node;
  value?: string;
}

export type HtmlElement = Node & { tagName: string; attrs: { name: string; value: string }[] };

export class HtmlShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HtmlShapeError";
  }
}

/** Elements whose text is never content. */
const NON_CONTENT = new Set(["script", "style", "noscript", "template", "svg", "head"]);

export function parseHtmlDocument(html: string): Node {
  return parse(html) as unknown as Node;
}

export function parseHtmlFragment(html: string): Node {
  return parseFragment(html) as unknown as Node;
}

export function* walk(node: Node): Generator<HtmlElement> {
  for (const child of node.childNodes ?? []) {
    if (child.tagName) yield child as HtmlElement;
    yield* walk(child);
  }
  if (node.content) yield* walk(node.content);
}

export function attr(element: Node, name: string): string | null {
  const found = element.attrs?.find((a) => a.name.toLowerCase() === name.toLowerCase());
  return found ? found.value : null;
}

/** The nearest ancestor with this tag name, or null. */
export function closest(element: Node, tag: string): HtmlElement | null {
  for (let node = element.parentNode ?? null; node; node = node.parentNode ?? null) {
    if (node.tagName === tag) return node as HtmlElement;
  }
  return null;
}

/** Direct element children with this tag name. */
export function childrenByTag(element: Node, tag: string): HtmlElement[] {
  return (element.childNodes ?? []).filter((c): c is HtmlElement => c.tagName === tag);
}

export function elementsWithAttr(root: Node, name: string): HtmlElement[] {
  return [...walk(root)].filter((el) => attr(el, name) !== null);
}

export function elementsByTag(root: Node, tag: string): HtmlElement[] {
  return [...walk(root)].filter((el) => el.tagName === tag);
}

function collectText(node: Node, out: string[]): void {
  if (node.nodeName === "#text") {
    out.push(node.value ?? "");
    return;
  }
  if (node.tagName && NON_CONTENT.has(node.tagName)) return;
  for (const child of node.childNodes ?? []) collectText(child, out);
}

/** Visible-ish text of a node, whitespace collapsed. Scripts and styles excluded. */
export function textOf(node: Node): string {
  const parts: string[] = [];
  collectText(node, parts);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Text of an HTML string such as a DataTables `ColumnN` value. Plain strings pass through. */
export function htmlText(value: unknown): string {
  if (typeof value !== "string") return value === null || value === undefined ? "" : String(value);
  if (!/[<&]/.test(value)) return value.replace(/\s+/g, " ").trim();
  return textOf(parseHtmlFragment(value));
}

/** All `href`s in an HTML string or node. */
export function hrefs(root: Node): string[] {
  return elementsByTag(root, "a")
    .map((a) => attr(a, "href"))
    .filter((h): h is string => typeof h === "string");
}

/** Every inline `<script>` body in a document, in order. */
export function inlineScripts(root: Node): string[] {
  return elementsByTag(root, "script")
    .filter((s) => attr(s, "src") === null)
    .map((s) => (s.childNodes ?? []).map((c) => c.value ?? "").join(""));
}

/**
 * Reads `var|let|const NAME = <literal>` from inline scripts.
 *
 * Returns `undefined` when the variable is absent, the parsed value otherwise
 * (a string, number, boolean, null, array or object). Throws `HtmlShapeError`
 * when the variable is present but its value is not a plain literal — that is
 * a changed page, and the caller fails the item or the listing on it.
 */
export function readInlineVar(root: Node, name: string): unknown {
  /* `=(?!=)`: an assignment, never an `==` comparison further down the script. */
  const pattern = new RegExp(`(?:\\bvar|\\blet|\\bconst|^|[;\\s])\\s*${name}\\s*=(?!=)\\s*`, "m");
  for (const script of inlineScripts(root)) {
    const match = pattern.exec(script);
    if (!match) continue;
    const start = match.index + match[0].length;
    return readLiteral(script, start, name);
  }
  return undefined;
}

function readLiteral(source: string, start: number, name: string): unknown {
  const first = source[start];
  if (first === "[" || first === "{") {
    const end = matchBracket(source, start);
    if (end === -1) throw new HtmlShapeError(`The page's ${name} value is not complete.`);
    try {
      return JSON.parse(source.slice(start, end + 1));
    } catch {
      throw new HtmlShapeError(`The page's ${name} value is not plain JSON.`);
    }
  }
  if (first === '"' || first === "'") {
    const { value } = readQuoted(source, start);
    return value;
  }
  const rest = source.slice(start);
  const scalar = /^(null|true|false|-?\d+(?:\.\d+)?)\s*(?:;|,|\n|$)/.exec(rest);
  if (scalar) return JSON.parse(scalar[1]!);
  throw new HtmlShapeError(`The page's ${name} value is not a plain literal.`);
}

function readQuoted(source: string, start: number): { value: string; end: number } {
  const quote = source[start];
  let out = "";
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === "\\") {
      const next = source[i + 1] ?? "";
      if (next === "u") {
        out += String.fromCharCode(parseInt(source.slice(i + 2, i + 6), 16));
        i += 5;
      } else {
        out += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
        i += 1;
      }
      continue;
    }
    if (ch === quote) return { value: out, end: i };
    out += ch;
  }
  throw new HtmlShapeError("An inline string value is not terminated.");
}

/** Index of the bracket closing the one at `start`, string-aware; -1 if none. */
function matchBracket(source: string, start: number): number {
  const stack: string[] = [];
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === '"' || ch === "'") {
      i = readQuoted(source, i).end;
      continue;
    }
    if (ch === "[" || ch === "{") stack.push(ch === "[" ? "]" : "}");
    else if (ch === "]" || ch === "}") {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/**
 * Normalised main-content text of a page, for change fingerprints. Prefers
 * `<main>`; falls back to `<body>`. Scripts, styles and form controls' values
 * never contribute, so a rotating anti-forgery token cannot look like a change.
 */
export function pageContentText(root: Node): string {
  const main = elementsByTag(root, "main")[0] ?? elementsByTag(root, "body")[0] ?? root;
  return textOf(main);
}

/** Whether an element carries this class. */
export function hasClass(element: Node, className: string): boolean {
  return (attr(element, "class") ?? "").split(/\s+/).includes(className);
}

export function elementsByClass(root: Node, className: string): HtmlElement[] {
  return [...walk(root)].filter((el) => hasClass(el, className));
}

/** The first element with this id, or null. (Pages repeat ids; callers scope the search.) */
export function byId(root: Node, id: string): HtmlElement | null {
  return [...walk(root)].find((el) => attr(el, "id") === id) ?? null;
}

const BLOCK = new Set([
  "p", "div", "section", "article", "li", "ul", "ol", "table", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "br", "hr",
]);

function collectBlockText(node: Node, out: string[]): void {
  if (node.nodeName === "#text") {
    out.push((node.value ?? "").replace(/[ \t\r\n\f]+/g, " "));
    return;
  }
  if (node.tagName && NON_CONTENT.has(node.tagName)) return;
  const block = node.tagName ? BLOCK.has(node.tagName) : false;
  if (block) out.push("\n");
  if (node.tagName === "li") out.push("• ");
  for (const child of node.childNodes ?? []) collectBlockText(child, out);
  if (node.content) collectBlockText(node.content, out);
  if (block) out.push("\n");
}

/**
 * Readable text of a content block, keeping paragraph and list breaks so the
 * chunker sees the document's own structure. Scripts and styles excluded.
 */
export function blockText(node: Node): string {
  const parts: string[] = [];
  collectBlockText(node, parts);
  return parts
    .join("")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, i, lines) => line.length > 0 || (i > 0 && lines[i - 1]!.length > 0))
    .join("\n")
    .trim();
}

/** `(text, href)` for each link inside a node, in order. */
export function linksOf(root: Node): { text: string; href: string }[] {
  return elementsByTag(root, "a")
    .map((a) => ({ text: textOf(a), href: attr(a, "href") ?? "" }))
    .filter((l) => l.href.length > 0 && !l.href.startsWith("#") && !/^javascript:/i.test(l.href));
}

/**
 * The quoted arguments of a JavaScript call written inline in an attribute,
 * e.g. `onclick="DownloadDocumentFromDashboard('a', 'b', 'c')"`. Read, never
 * run. Returns null when the call is absent or not all-string-literal.
 */
export function inlineCallArgs(source: string, fn: string): string[] | null {
  const start = source.indexOf(`${fn}(`);
  if (start === -1) return null;
  const args: string[] = [];
  let i = start + fn.length + 1;
  for (;;) {
    while (/\s/.test(source[i] ?? "")) i += 1;
    const ch = source[i];
    if (ch === ")") return args;
    if (ch !== "'" && ch !== '"') return null;
    const quoted = readQuotedAt(source, i);
    args.push(quoted.value);
    i = quoted.end + 1;
    while (/\s/.test(source[i] ?? "")) i += 1;
    if (source[i] === ",") i += 1;
    else if (source[i] === ")") return args;
    else return null;
  }
}

function readQuotedAt(source: string, start: number): { value: string; end: number } {
  const quote = source[start];
  let out = "";
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === "\\") {
      out += source[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (ch === quote) return { value: out, end: i };
    out += ch;
  }
  throw new HtmlShapeError("An inline call argument is not terminated.");
}
