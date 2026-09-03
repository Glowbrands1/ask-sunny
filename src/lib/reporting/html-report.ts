import { ReportParseError } from "./errors";
import { sheetViewFromGrid, type WorkbookView } from "./workbook";

/**
 * ============================================================================
 * READING A REPORT THAT IS HTML WEARING AN .xls EXTENSION
 * ============================================================================
 *
 * The Sales Totals report arrives as `SalesTotals.xls` and is not a workbook at
 * all. It is an HTML page: `<html><title>Sales Totals</title>`, an `<h3>` with
 * the report date, and tables of figures. ExcelJS refuses it, so without this
 * the file cannot be read by the existing pipeline.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: build a DOM.
 *
 * The file is untrusted third-party content and it carries live markup —
 * observed in the real sample:
 *
 *     <script type="text/javascript" src='/inc/js/number_formats.js'>
 *     <form action="/dailysales/SalesTotals.php" method='POST'>
 *     <input type='hidden' name='process' value=2>
 *
 * A DOM parser is the wrong instrument for that. `jsdom` is a devDependency, so
 * it is not even present at runtime, and it exists to *simulate a browser* —
 * fetching subresources and running scripts are features it has to be talked
 * out of. The safe posture is not "a DOM with scripts disabled"; it is never
 * constructing an execution context in the first place.
 *
 * So this is a deliberately dumb text extractor. It finds `<tr>` and `<td>`
 * spans and reads the text between them. `<script>` and `<style>` blocks are
 * discarded WITH THEIR CONTENTS before anything else happens, so script source
 * can never be mistaken for a cell value. Nothing is fetched. `src`, `href`,
 * `action` and every other attribute are ignored entirely — they are never
 * read, so there is nothing to resolve. No `eval`, no `Function`, no dynamic
 * import, no network.
 *
 * The output is a `WorkbookView`, the same shape ExcelJS produces, so a Sales
 * Totals parser is an ordinary `ReportParser` and the whole ingestion
 * orchestration — idempotency, lineage, supersession — is reused rather than
 * duplicated.
 */

/** How much of the file to inspect when guessing the format. */
const SNIFF_BYTES = 1024;

/** The sheet name an HTML report is presented under. */
export const HTML_SHEET_NAME = "Report";

/** Guard against a pathological file exhausting memory in the scanner. */
const MAX_CELLS = 50_000;

/**
 * Whether these bytes are an HTML document rather than a workbook.
 *
 * Content, never the filename — the whole problem is that the extension lies.
 * A `.xlsx` is a ZIP and begins `PK\x03\x04`; this looks for the positive
 * signal instead of assuming "not a ZIP means HTML".
 */
export function looksLikeHtmlReport(buffer: Uint8Array): boolean {
  if (buffer.byteLength === 0) return false;
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(buffer.subarray(0, SNIFF_BYTES))
    // A UTF-8 BOM or leading whitespace must not defeat the check.
    .replace(/^﻿/, "")
    .trimStart()
    .toLowerCase();

  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    // Some report generators omit both and open straight into a table.
    (head.includes("<table") && head.includes("<t"))
  );
}

/** The handful of entities these reports actually use. */
const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (match) => ENTITIES[match] ?? match)
    // Numeric entities, decimal and hex. Bounded to valid code points.
    .replace(/&#(\d{1,7});/g, (_, code: string) => safeCodePoint(Number(code)))
    .replace(/&#[xX]([0-9a-fA-F]{1,6});/g, (_, code: string) =>
      safeCodePoint(Number.parseInt(code, 16)),
    );
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Markup to plain text: drop tags, decode entities, collapse whitespace. */
function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Removes anything whose CONTENT is code rather than text.
 *
 * Done first and unconditionally. If a `<script>` body survived to the cell
 * scanner, JavaScript source could be read in as a report value — and a
 * `document.write` of a `<tr>` would become a row of figures nobody sent.
 * Comments go too, because `<!-- <tr><td>999</td></tr> -->` is not data.
 */
function stripNonContent(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // An unterminated <script ...> would otherwise leave its body in the text.
    .replace(/<script\b[\s\S]*$/i, " ");
}

/**
 * Text that sits OUTSIDE the tables: the `<title>` and any heading.
 *
 * These carry the report's identity. In the real sample the report date is in
 * `<h3>Sales Totals for 09-02-2026</h3>` and appears nowhere in the tables, so
 * a reader that returned only table rows could not tell which day the figures
 * belong to — and the filename must not be trusted for it.
 */
function documentHeadings(html: string): string[] {
  const lines: string[] = [];
  const title = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (title) {
    const text = cellText(title[1]);
    if (text) lines.push(text);
  }
  for (const match of html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi)) {
    const text = cellText(match[1]);
    if (text) lines.push(text);
  }
  return lines;
}

/** Every `<tr>` in document order, across every table, as rows of text. */
function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  let cells = 0;

  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(
      /<t([dh])\b[^>]*>([\s\S]*?)<\/t\1\s*>/gi,
    )) {
      row.push(cellText(cellMatch[2]));
      if ((cells += 1) > MAX_CELLS) {
        throw new ReportParseError(
          "workbook_unreadable",
          `The report has more than ${MAX_CELLS} cells, which is far beyond any expected report.`,
        );
      }
    }
    if (row.length > 0) rows.push(row);
  }

  return rows;
}

/**
 * Reads an HTML report into the same view a workbook produces.
 *
 * The grid is the document's heading lines first, each on its own row, then
 * every table row in document order. Headings become rows so that a parser can
 * find the title and the report date the same way it finds any other marker —
 * by looking in cells — instead of needing a second, differently shaped input.
 */
export function readHtmlReport(
  buffer: Uint8Array,
  sheetName: string = HTML_SHEET_NAME,
): WorkbookView {
  if (buffer.byteLength === 0) {
    throw new ReportParseError("workbook_unreadable", "The file is empty.");
  }

  const raw = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const html = stripNonContent(raw);

  const grid: (string | number | null)[][] = [
    ...documentHeadings(html).map((line) => [line]),
    ...tableRows(html),
  ];

  if (grid.length === 0) {
    throw new ReportParseError(
      "workbook_unreadable",
      "The file looks like HTML but contains no headings and no table rows.",
    );
  }

  const sheet = sheetViewFromGrid(sheetName, grid);
  return {
    sheetNames: [sheetName],
    sheet: (name: string) => (name === sheetName ? sheet : null),
  };
}
