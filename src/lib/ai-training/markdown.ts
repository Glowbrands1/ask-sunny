/**
 * NOTION-FLAVOURED MARKDOWN -> BLOCKS, for AI Training lessons and pages.
 *
 * Ported from the JBA AI Training app (`src/lib/notion-md.ts`), whose lessons
 * were pasted from Notion and are stored as this markdown. Same syntax, same
 * output shape, so imported lessons render as they did there:
 *
 *   # / ## / ### headings, paragraphs, **bold**, *italic*, `code`, ~~strike~~,
 *   [links](url), - and 1. lists (nested by indentation), - [ ] / - [x] to-dos,
 *   ``` fenced code, > quotes, --- dividers, markdown and <table> tables,
 *   <callout icon="🎓" color="orange_bg">…</callout>, <details><summary> toggles,
 *   ![images](url) and <page url="…">links</page>.
 *
 * Pure and isomorphic. Block ids are numbered PER PARSE (the original kept one
 * module-wide counter), so the server and the browser give the same ids to the
 * same markdown and hydration does not mismatch.
 */

export interface RichText {
  text: string;
  href?: string | null;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
}

export type BlockType =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "divider"
  | "quote"
  | "callout"
  | "toggle"
  | "table"
  | "code"
  | "image"
  | "to_do"
  | "bulleted_list_item"
  | "numbered_list_item";

export interface MdBlock {
  id: string;
  type: BlockType;
  text?: RichText[];
  children?: MdBlock[];
  /** callout */
  icon?: string;
  color?: string;
  /** code */
  language?: string;
  code?: string;
  /** to_do */
  checked?: boolean;
  /** table */
  rows?: RichText[][][];
  header?: boolean;
  /** image */
  url?: string;
  caption?: RichText[];
}

type Style = Omit<RichText, "text" | "href">;

/* ---------------- inline ---------------- */

export function parseInline(src: string): RichText[] {
  // Drop inline HTML wrappers that carry no styling we keep (Notion's colour spans, mentions).
  const text = src.replace(/<\/?(span|mention-[a-z]+)\b[^>]*>/gi, "");
  const out: RichText[] = [];
  walk(text, {}, null, out);
  return merge(out);
}

function walk(s: string, style: Style, href: string | null, out: RichText[]) {
  let buf = "";
  const flush = () => {
    if (buf) out.push({ text: buf, href, ...style });
    buf = "";
  };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    if (rest[0] === "\\" && rest.length > 1) {
      buf += rest[1];
      i += 2;
      continue;
    }
    if (rest[0] === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ text: s.slice(i + 1, end), href, ...style, code: true });
        i = end + 1;
        continue;
      }
    }
    const br = /^<br\s*\/?>/i.exec(rest);
    if (br) {
      buf += "\n";
      i += br[0].length;
      continue;
    }
    const tag = /^<(b|strong|i|em|u|s|del|strike|code|a)\b([^>]*)>/i.exec(rest);
    if (tag) {
      const name = tag[1].toLowerCase();
      const after = s.slice(i + tag[0].length);
      const close = new RegExp(`</${name}\\s*>`, "i").exec(after);
      if (close) {
        flush();
        const inner = after.slice(0, close.index);
        if (name === "code") out.push({ text: inner, href, ...style, code: true });
        else if (name === "a") walk(inner, style, /href="([^"]*)"/i.exec(tag[2])?.[1] ?? href, out);
        else {
          const key: keyof Style =
            name === "b" || name === "strong"
              ? "bold"
              : name === "i" || name === "em"
                ? "italic"
                : name === "u"
                  ? "underline"
                  : "strikethrough";
          walk(inner, { ...style, [key]: true }, href, out);
        }
        i += tag[0].length + close.index + close[0].length;
        continue;
      }
    }
    const link = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      flush();
      walk(link[1], style, link[2], out);
      i += link[0].length;
      continue;
    }
    const delimiters: [string, keyof Style][] = [
      ["**", "bold"],
      ["~~", "strikethrough"],
      ["*", "italic"],
      ["_", "italic"],
    ];
    let matched = false;
    for (const [d, key] of delimiters) {
      if (rest.startsWith(d)) {
        // snake_case_words are not italics.
        if (d === "_" && /\w/.test(s[i - 1] ?? "")) break;
        const end = findClose(s, i + d.length, d);
        if (end > i + d.length) {
          flush();
          walk(s.slice(i + d.length, end), { ...style, [key]: true }, href, out);
          i = end + d.length;
          matched = true;
        }
        break;
      }
    }
    if (matched) continue;
    buf += s[i];
    i++;
  }
  flush();
}

function findClose(s: string, from: number, d: string): number {
  let i = from;
  while (i < s.length) {
    if (s[i] === "\\") {
      i += 2;
      continue;
    }
    if (s[i] === "`") {
      const e = s.indexOf("`", i + 1);
      if (e > 0) {
        i = e + 1;
        continue;
      }
    }
    if (s.startsWith(d, i)) {
      if (d === "*" && s[i + 1] === "*") {
        i += 2;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

function sameStyle(a: RichText, b: RichText): boolean {
  return (
    (a.href ?? null) === (b.href ?? null) &&
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.strikethrough === !!b.strikethrough &&
    !!a.code === !!b.code
  );
}

function merge(runs: RichText[]): RichText[] {
  const out: RichText[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last && sameStyle(last, run)) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}

/* ---------------- blocks ---------------- */

function indentOf(line: string): number {
  const lead = /^[\t ]*/.exec(line)![0];
  let n = 0;
  for (const c of lead) n += c === "\t" ? 4 : 1;
  return n;
}

function dedent(lines: string[]): string[] {
  const nonEmpty = lines.filter((l) => l.trim());
  if (!nonEmpty.length) return lines;
  const min = Math.min(...nonEmpty.map(indentOf));
  return lines.map((l) => {
    let removed = 0;
    let k = 0;
    while (k < l.length && removed < min && (l[k] === " " || l[k] === "\t")) {
      removed += l[k] === "\t" ? 4 : 1;
      k++;
    }
    return l.slice(k);
  });
}

/** Lines up to the matching closing tag, counting nested opens. */
function collectTag(lines: string[], start: number, open: RegExp, close: RegExp, firstRest: string) {
  let depth = 1;
  const body: string[] = [];
  const token = new RegExp(`(${open.source})|(${close.source})`, "gi");
  let i = start;
  let segment = firstRest;
  while (true) {
    token.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = token.exec(segment))) {
      depth += m[1] ? 1 : -1;
      if (depth === 0) {
        const before = segment.slice(0, m.index);
        if (before.trim()) body.push(before);
        return { body, next: i + 1 };
      }
    }
    if (i !== start || segment.trim()) body.push(segment);
    i++;
    if (i >= lines.length) return { body, next: i };
    segment = lines[i];
  }
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(\[( |x|X)\]\s+)?(.*)$/;

export function parseTrainingMarkdown(md: string): MdBlock[] {
  let counter = 0;
  const id = () => `b${++counter}`;
  const lines = (md ?? "").replace(/\r\n?/g, "\n").split("\n");
  return parseLines(dedent(lines), id);
}

function parseLines(lines: string[], id: () => string): MdBlock[] {
  const out: MdBlock[] = [];
  const kids = (body: string[]) => {
    const children = parseLines(dedent(body), id);
    return children.length ? children : undefined;
  };
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || /^<empty-block\s*\/?>$/i.test(line)) {
      i++;
      continue;
    }

    const callout = /^<callout\b([^>]*)>(.*)$/i.exec(line);
    if (callout) {
      const icon = /icon="([^"]*)"/.exec(callout[1])?.[1] ?? "";
      const color = /color="([^"]*)"/.exec(callout[1])?.[1] ?? "default";
      const { body, next } = collectTag(lines, i, /<callout\b/, /<\/callout>/, callout[2]);
      out.push({ id: id(), type: "callout", icon, color, children: kids(body) });
      i = next;
      continue;
    }

    const details = /^<details\b[^>]*>(.*)$/i.exec(line);
    if (details) {
      const { body, next } = collectTag(lines, i, /<details\b/, /<\/details>/, details[1]);
      const joined = body.join("\n");
      const summary = /<summary>([\s\S]*?)<\/summary>/i.exec(joined);
      const inner = summary ? joined.replace(summary[0], "") : joined;
      out.push({
        id: id(),
        type: "toggle",
        text: parseInline(summary ? summary[1].trim() : ""),
        children: kids(inner.split("\n")),
      });
      i = next;
      continue;
    }

    if (/^<table\b/i.test(line)) {
      const { body, next } = collectTag(lines, i, /<table\b/, /<\/table>/, line.replace(/^<table\b[^>]*>/i, ""));
      const html = body.join("\n");
      const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
        [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => parseInline(c[1].trim())),
      );
      out.push({ id: id(), type: "table", rows, header: /header-row="true"/i.test(line) || /<th\b/i.test(html) });
      i = next;
      continue;
    }

    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const cells = (l: string) =>
        l
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const isSeparator = (l: string) => /^\|?\s*:?-{2,}/.test(l) && cells(l).every((c) => /^:?-+:?$/.test(c));
      const header = tableLines.length > 1 && isSeparator(tableLines[1]);
      const rows = tableLines.filter((l) => !isSeparator(l)).map((l) => cells(l).map(parseInline));
      out.push({ id: id(), type: "table", rows, header });
      continue;
    }

    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++;
      out.push({ id: id(), type: "code", language: fence[1] || "plain text", code: code.join("\n") });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      out.push({ id: id(), type: `heading_${level}`, text: parseInline(heading[2]) });
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      out.push({ id: id(), type: "divider" });
      i++;
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push({ id: id(), type: "quote", text: parseInline(quote.join("\n")) });
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line);
    if (image) {
      out.push({ id: id(), type: "image", url: image[2], caption: image[1] ? parseInline(image[1]) : [] });
      i++;
      continue;
    }

    const page = /^<page\b[^>]*?(?:url="([^"]*)")?[^>]*>(.*?)<\/page>$/i.exec(line);
    if (page) {
      out.push({ id: id(), type: "paragraph", text: [{ text: page[2], href: page[1] ?? null }] });
      i++;
      continue;
    }

    if (LIST_RE.test(raw)) {
      const base = indentOf(raw);
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // A blank line inside a list continues it when the next line is still the list.
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && (indentOf(lines[j]) > base || (LIST_RE.test(lines[j]) && indentOf(lines[j]) === base))) {
            i = j;
            continue;
          }
          break;
        }
        const m = LIST_RE.exec(l);
        if (!m || indentOf(l) !== base) break;
        i++;
        const childLines: string[] = [];
        while (i < lines.length && (!lines[i].trim() || indentOf(lines[i]) > base)) {
          if (!lines[i].trim()) {
            let j = i + 1;
            while (j < lines.length && !lines[j].trim()) j++;
            if (j >= lines.length || indentOf(lines[j]) <= base) break;
          }
          childLines.push(lines[i]);
          i++;
        }
        const children = childLines.length ? kids(childLines) : undefined;
        const text = parseInline(m[5]);
        if (m[3]) out.push({ id: id(), type: "to_do", text, checked: m[4].toLowerCase() === "x", children });
        else if (/\d/.test(m[2])) out.push({ id: id(), type: "numbered_list_item", text, children });
        else out.push({ id: id(), type: "bulleted_list_item", text, children });
      }
      continue;
    }

    out.push({ id: id(), type: "paragraph", text: parseInline(line) });
    i++;
  }
  return out;
}

/* ---------------- prompt copying ---------------- */

export const plainText = (runs: RichText[] = []) => runs.map((r) => r.text).join("");
export const unescapePrompt = (text: string): string => text.replace(/\\([\\`*{}[\]()#+.!_>~-])/g, "$1");

export interface PromptQuote {
  start: number;
  end: number;
  text: string;
}

/**
 * Quoted prompts ("…" of 25+ characters, not in code) inside a Practice
 * section, which get their own Copy button. Offsets are into the rendered text.
 */
export function extractPromptQuotes(runs: RichText[], practice: boolean): PromptQuote[] {
  if (!practice) return [];
  const text = plainText(runs);
  const quotes: PromptQuote[] = [];
  for (const match of text.matchAll(/"([^"\n]+)"|“([^”]+)”/g)) {
    const body = unescapePrompt(match[1] ?? match[2]);
    const start = match.index ?? 0;
    const end = start + match[0].length;
    let offset = 0;
    const inCode = runs.some((run) => {
      const overlaps = offset < end && offset + run.text.length > start;
      offset += run.text.length;
      return overlaps && run.code;
    });
    if (body.length >= 25 && !inCode) quotes.push({ start, end, text: body });
  }
  return quotes;
}

/**
 * Blocks inside a "Practice" section. Nested lists, to-dos and callouts inherit
 * it; siblings after the section ends do not. Intro callouts (🎓 💡 🔒) never do.
 */
export function practiceBlockIds(blocks: MdBlock[]): Set<string> {
  const ids = new Set<string>();
  function visit(items: MdBlock[], inherited = 0) {
    let level = inherited;
    for (const block of items) {
      const heading = /^heading_(\d)$/.exec(block.type);
      if (heading) {
        const depth = Number(heading[1]);
        const title = plainText(block.text).trim();
        if (/^(?:🛠️?\s*)?Practice\b/i.test(title)) level = depth;
        else if (level && depth <= level) level = 0;
      } else if (level && block.type !== "code") ids.add(block.id);
      if (block.children) {
        const intro = block.type === "callout" && ["🎓", "💡", "🔒"].includes(block.icon ?? "");
        visit(block.children, intro ? 0 : level);
      }
    }
  }
  visit(blocks);
  return ids;
}

/* ---------------- sections and links ---------------- */

/**
 * Splits markdown at each top-level "## " heading (outside code), for the Best
 * Practices page's tabs. The heading stays at the top of its section.
 */
export function splitSections(md: string): { intro: string; sections: { title: string; body: string }[] } {
  const sections: { title: string; lines: string[] }[] = [];
  const intro: string[] = [];
  let inCode = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    const m = !inCode && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) sections.push({ title: m[1].replace(/[*_`]/g, "").replace(/<[^>]+>/g, ""), lines: [line] });
    else if (sections.length) sections[sections.length - 1].lines.push(line);
    else intro.push(line);
  }
  return { intro: intro.join("\n"), sections: sections.map((s) => ({ title: s.title, body: s.lines.join("\n") })) };
}

/**
 * Links written for the old app point at its routes. `/assignments/<track>/<slug>`
 * is now `/ai-training/<track>/<slug>`, and its Policy and Best Practices pages
 * are tabs here. Anything else is left as written.
 */
export function rewriteTrainingHref(href: string): string {
  const path = href.replace(/^https?:\/\/[^/]*jba-ai-training[^/]*\.lovable\.app/i, "");
  if (/^\/assignments\/[^/]+\/[^/?#]+/.test(path)) return path.replace(/^\/assignments\//, "/ai-training/");
  if (/^\/assignments\/?(\?.*)?$/.test(path)) return "/ai-training";
  if (path === "/policy") return "/ai-training?tab=policy";
  if (path === "/best-practices") return "/ai-training?tab=best-practices";
  return href;
}

/** Splits "Module 3: Claude at Work" into a "Module 3" pill and its name. */
export function splitModuleTitle(title: string): { label: string; rest: string } | null {
  const m = title.match(/^(Module\s+\d+)\s*:\s*(.+)$/i);
  return m ? { label: m[1], rest: m[2] } : null;
}
