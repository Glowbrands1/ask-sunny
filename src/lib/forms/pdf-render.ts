import { deflateSync } from "node:zlib";

import { imageAssetBytes, resolveImageAsset } from "./assets";
import {
  interpolate,
  renderDocument,
  type FormBlock,
  type FormDocument,
  type FormDocumentStyle,
  type FormVariant,
} from "./document";
import { LEADING, PAGE, SIZE, pageLayout, type PageLayout } from "./paper";
import { decodePng } from "./png";

/**
 * THE STRUCTURED RENDERER — the document engine that produces the actual PDF.
 *
 * The supplied reference PDFs carry NO AcroForm fields (checked in Phase 0 and
 * re-checked by `pdf-inspect.test.ts`), so there is nothing to fill by field
 * name. A generated form is therefore DRAWN from the published template version
 * and the values on the form, which is also what makes the output correct by
 * construction: it renders the same blocks the manager filled, in the same
 * order, from the same version.
 *
 * WRITTEN DIRECTLY RATHER THAN THROUGH A PDF LIBRARY. Every candidate library
 * still leaves the layout — wrapping, page breaks, checkbox rows, signature
 * rules — to be written by hand, so a dependency would have bought the object
 * model and nothing else, on a feature that handles HR records. What it costs
 * is the width tables below; what it buys is no third-party code in the path
 * that renders an employee's disciplinary record.
 *
 * WHAT MUST NOT APPEAR ON THE PAGE, and is asserted in the tests:
 *   AI FILLS / FILLED BY HAND chips — editor furniture, not document content
 *   any editor control, sidebar or top bar
 *   the instructions an administrator sees above the editor
 * The printed form is the corporate document: white paper, black section bars,
 * ruled lines, empty signature lines. The Ask Sunny theme stops at the browser.
 */

/* --------------------------------------------------------- font metrics --- */

/**
 * Helvetica and Helvetica-Bold advance widths, in 1/1000 em, for ASCII 32–126.
 *
 * The standard 14 fonts need no embedding, but a viewer only knows how to DRAW
 * them — it will not wrap a paragraph. These tables are what let this code
 * measure a string before it commits to a line, which is the whole of text
 * layout.
 */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

type FontName = "regular" | "bold";

function charWidth(code: number, font: FontName): number {
  const table = font === "bold" ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  if (code < 32 || code > 126) return table[0];
  return table[code - 32];
}

export function textWidth(text: string, size: number, font: FontName = "regular"): number {
  let total = 0;
  for (const char of asciiOnly(text)) total += charWidth(char.charCodeAt(0), font);
  return (total * size) / 1000;
}

/**
 * The standard 14 fonts are WinAnsi, and this document is drawn without an
 * embedded font — so a curly quote or an em dash would print as the wrong
 * glyph. Rather than let a manager's pasted text come out mangled, the
 * characters that actually turn up in this content are folded to their ASCII
 * equivalents and anything else becomes a plain question mark, which is
 * visibly a substitution rather than a silent wrong letter.
 */
export function asciiOnly(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/·/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E\n]/g, "?");
}

/**
 * Greedy wrap. Long unbreakable tokens are hard-split rather than overflowing.
 *
 * `font` IS NOT OPTIONAL, and that is the point. It used to default to
 * "regular" while the values on a form print in bold — so every filled
 * sentence was measured in the narrower face and drawn in the wider one, and
 * the last word or two of a wrapped line hung out past the ruled line and, on
 * a long paragraph, past the right margin of the page. Requiring the face here
 * makes that mismatch a compile error rather than something you find on a
 * printed disciplinary record.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  font: FontName,
): string[] {
  const source = asciiOnly(text);
  const lines: string[] = [];

  for (const paragraph of source.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, font) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (textWidth(word, size, font) <= maxWidth) {
        line = word;
        continue;
      }
      // A single token wider than the column: split it rather than run off the
      // page. Happens with pasted URLs and long employee identifiers.
      let chunk = "";
      for (const char of word) {
        if (textWidth(chunk + char, size, font) > maxWidth) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      line = chunk;
    }
    if (line) lines.push(line);
  }

  return lines;
}

/* ------------------------------------------------------------ the sheet --- */

/*
 * The page geometry is imported, not declared. It is shared with the on-screen
 * document canvas so the paper an administrator edits and the paper that comes
 * out of the printer are the same paper. See `lib/forms/paper.ts`.
 */

interface Op {
  /** Content-stream fragment, already positioned. */
  draw: string;
}

class Page {
  ops: Op[] = [];
  constructor(public readonly index: number) {}
}

/**
 * THE VISUAL DECISIONS FOR ONE RENDER, RESOLVED ONCE.
 *
 * Built from the version's stored style, with the defaults that reproduce the
 * page this renderer drew before the style model existed. Every drawing
 * function reads it off the sheet, so nothing in this file ever asks which
 * template it is rendering.
 */
interface Layout extends PageLayout {
  headingStyle: "bar" | "rule";
  letterhead: "chip" | "centered";
  signatureLayout: "inline" | "ruled";
}

function layoutFor(style: FormDocumentStyle | undefined): Layout {
  return {
    ...pageLayout(style?.margins),
    headingStyle: style?.headingStyle ?? "bar",
    letterhead: style?.letterhead ?? "chip",
    signatureLayout: style?.signatureLayout ?? "inline",
  };
}

/** An image placed on a page, resolved to samples a PDF can carry. */
interface PlacedImage {
  id: string;
  width: number;
  height: number;
  rgb: Uint8Array;
  x: number;
  y: number;
  drawWidth: number;
  drawHeight: number;
}

function escapeText(text: string): string {
  return asciiOnly(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

class Sheet {
  pages: Page[] = [new Page(0)];
  images: PlacedImage[] = [];
  y: number;

  constructor(readonly layout: Layout) {
    this.y = PAGE.height - layout.margin.top;
  }

  /** Places an image on the FIRST page, in absolute page coordinates. */
  place(image: Omit<PlacedImage, "id">): void {
    this.images.push({ ...image, id: `/Im${this.images.length + 1}` });
  }

  get page(): Page {
    return this.pages[this.pages.length - 1];
  }

  newPage(): void {
    this.pages.push(new Page(this.pages.length));
    this.y = PAGE.height - this.layout.margin.top;
  }

  /** Starts a new page when the next thing would not fit above the footer. */
  ensure(height: number): void {
    if (this.y - height < this.layout.margin.bottom) this.newPage();
  }

  text(value: string, x: number, size: number, font: FontName, color = "0 0 0"): void {
    const resource = font === "bold" ? "/F2" : "/F1";
    this.page.ops.push({
      draw: `BT ${color} rg ${resource} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${this.y.toFixed(2)} Tm (${escapeText(value)}) Tj ET`,
    });
  }

  rect(x: number, y: number, width: number, height: number, fill: string): void {
    this.page.ops.push({
      draw: `${fill} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`,
    });
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.6, gray = "0.55"): void {
    this.page.ops.push({
      draw: `${gray} G ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`,
    });
  }

  box(x: number, y: number, size: number): void {
    this.page.ops.push({
      draw: `0.25 G 0.9 w ${x.toFixed(2)} ${y.toFixed(2)} ${size.toFixed(2)} ${size.toFixed(2)} re S`,
    });
  }

  /** A ticked box: two strokes, so it reads as marked by a person. */
  tick(x: number, y: number, size: number): void {
    const pad = size * 0.22;
    this.page.ops.push({
      draw: `0 G 1.3 w ${(x + pad).toFixed(2)} ${(y + pad).toFixed(2)} m ${(x + size - pad).toFixed(2)} ${(y + size - pad).toFixed(2)} l S ${(x + pad).toFixed(2)} ${(y + size - pad).toFixed(2)} m ${(x + size - pad).toFixed(2)} ${(y + pad).toFixed(2)} l S`,
    });
  }
}

/**
 * THE TWO FACES ON THE PAPER.
 *
 * A label is the printed form talking; a value is what someone put on it, and
 * it prints bold so a filed page reads at a glance. Helvetica-Bold is up to 8%
 * wider than Helvetica, so which of these a piece of text is decides both how
 * it is drawn AND how it is measured. Every wrap below names one of them.
 */
const LABEL_FONT: FontName = "regular";
const VALUE_FONT: FontName = "bold";

/* --------------------------------------------------------------- values --- */

export interface RenderValues {
  values: Record<string, string>;
  checked: Record<string, string[]>;
}

export interface RenderMeta {
  templateName: string;
  templateVersion: number;
  employeeName: string;
  formDate: string;
  locationName?: string | null;
  /** Printed in the footer so a filed page can be traced to its record. */
  reference?: string | null;
  status: "draft" | "finalized" | "revised";
}

/* SIZE and LEADING come from `paper.ts` too — see the note above PAGE. */

/**
 * A section heading, in whichever of the two official treatments this version
 * uses.
 *
 *   bar   a black band with white centred type — the EPPs, the DPOA, the
 *         hiring forms, and every version written before the style model.
 *   rule  centred black type over a hairline across the page, which is how
 *         the business's own Word documents set a heading.
 *
 * Both are centred on the same content width, so a version can change its mind
 * without anything else on the page moving.
 */
function drawSection(sheet: Sheet, label: string): void {
  const { margin, contentWidth } = sheet.layout;

  if (sheet.layout.headingStyle === "rule") {
    sheet.ensure(32);
    sheet.y -= 6;
    const size = SIZE.section + 1.5;
    const width = textWidth(label, size, "bold");
    sheet.text(label, margin.left + (contentWidth - width) / 2, size, "bold");
    sheet.y -= 6;
    // A filled sliver rather than a stroke: the source rule is 0.48pt, thinner
    // than a stroke renders predictably at screen zoom.
    sheet.rect(margin.left, sheet.y, contentWidth, 0.5, "0 0 0");
    sheet.y -= 14;
    return;
  }

  sheet.ensure(34);
  const height = 18;
  sheet.rect(margin.left, sheet.y - height + 5, contentWidth, height, "0 0 0");
  sheet.y -= height - 8;
  const width = textWidth(label, SIZE.section, "bold");
  sheet.text(label, margin.left + (contentWidth - width) / 2, SIZE.section, "bold", "1 1 1");
  sheet.y -= 16;
}

/**
 * A labelled ruled line: `Employee Name ______________`.
 *
 * The label sits inline with the value while it fits in its share of the
 * column. A label too long for that share takes its own wrapped lines above a
 * full-width rule instead — the old code clamped where the value STARTED but
 * still drew the whole label, so a question like "What do you feel is the most
 * important skill for a District Manager to possess?" was overprinted by the
 * answer written on top of it. Several EPP questions are a full sentence, and
 * longer again once a variant's role name is interpolated into them.
 */
function drawValueLine(
  sheet: Sheet,
  label: string,
  value: string,
  x: number,
  width: number,
): void {
  const labelWidth = textWidth(label, SIZE.label, LABEL_FONT) + 8;

  if (labelWidth > width * 0.55) {
    for (const line of wrapText(label, width, SIZE.label, LABEL_FONT)) {
      sheet.ensure(LEADING);
      sheet.text(line, x, SIZE.label, LABEL_FONT);
      sheet.y -= LEADING;
    }
    drawRuledValue(sheet, value, x, width);
    return;
  }

  sheet.text(label, x, SIZE.label, LABEL_FONT);
  const valueX = x + labelWidth;
  drawRuledValue(sheet, value, valueX, x + width - valueX);
}

/**
 * Wrapped value text, each line sitting on its own rule.
 *
 * The one place a value is measured and drawn, so the width it was wrapped to
 * and the width it is ruled to are the same number by construction.
 */
function drawRuledValue(sheet: Sheet, value: string, x: number, width: number): void {
  // An unanswered field still gets its rule — a blank ruled line is where the
  // conversation happens — so there is always at least one line to draw.
  const lines = wrapText(value, width, SIZE.body, VALUE_FONT);
  if (lines.length === 0) lines.push("");
  lines.forEach((line, index) => {
    if (index > 0) {
      sheet.y -= LEADING;
      sheet.ensure(LEADING);
    }
    sheet.text(line, x, SIZE.body, VALUE_FONT);
    sheet.line(x, sheet.y - 3, x + width, sheet.y - 3);
  });
}

function drawBlock(
  sheet: Sheet,
  block: FormBlock,
  values: RenderValues,
  variant: FormVariant | null,
): void {
  switch (block.kind) {
    case "letterhead": {
      const { margin, contentWidth } = sheet.layout;
      const brand = asciiOnly(block.brand);

      if (sheet.layout.letterhead === "centered") {
        /*
         * The masthead of the business's own document: the form's name, then
         * the brand beneath it, both centred. The logo is not drawn here — it
         * is anchored to the page corner in `renderFormPdf`, exactly as it is
         * anchored to the page in the Word source, so it does not move when
         * this block does.
         */
        sheet.ensure(52);
        const titleWidth = textWidth(block.title, SIZE.title + 1, "bold");
        sheet.text(
          block.title,
          margin.left + (contentWidth - titleWidth) / 2,
          SIZE.title + 1,
          "bold",
        );
        sheet.y -= 18;
        // Printed exactly as the version stores it. The Word source sets the
        // subtitle in title case, so the version stores it that way rather than
        // the renderer second-guessing anyone's brand.
        const brandWidth = textWidth(brand, SIZE.section + 1.5, "bold");
        sheet.text(brand, margin.left + (contentWidth - brandWidth) / 2, SIZE.section + 1.5, "bold");
        sheet.y -= 26;
        break;
      }

      sheet.ensure(46);
      const chipWidth = textWidth(brand, SIZE.small, "bold") + 22;
      sheet.rect(margin.left, sheet.y - 6, chipWidth, 20, "0 0 0");
      sheet.text(brand, margin.left + 11, SIZE.small, "bold", "1 1 1");
      sheet.text(block.title, margin.left + chipWidth + 16, SIZE.title, "bold");
      sheet.y -= 30;
      break;
    }

    case "section":
      drawSection(sheet, block.label);
      break;

    case "paragraph":
    case "acknowledgement": {
      const lines = wrapText(block.text, sheet.layout.contentWidth, SIZE.body, "regular");
      for (const line of lines) {
        sheet.ensure(LEADING);
        sheet.text(line, sheet.layout.margin.left, SIZE.body, "regular");
        sheet.y -= LEADING;
      }
      sheet.y -= 4;
      break;
    }

    case "note": {
      // Guidance for whoever fills the form in person. Kept small and grey so
      // it reads as an instruction rather than as part of the record.
      const lines = wrapText(block.text, sheet.layout.contentWidth, SIZE.small, "regular");
      for (const line of lines) {
        sheet.ensure(11);
        sheet.text(line, sheet.layout.margin.left, SIZE.small, "regular", "0.4 0.4 0.4");
        sheet.y -= 11;
      }
      sheet.y -= 4;
      break;
    }

    case "field": {
      sheet.ensure(LEADING + 8);
      const value = values.values[block.field.key] ?? "";
      if (block.field.input === "long_text") {
        /*
         * The label is wrapped rather than printed as one line: the phone
         * prescreen asks "Are you willing to use our services as part of your
         * Sun Tan City uniform? (Must agree to UV, Sunless and Spa usage to
         * proceed with employment)", which is half a page wider than the paper.
         */
        for (const line of wrapText(block.field.label, sheet.layout.contentWidth, SIZE.label, LABEL_FONT)) {
          sheet.ensure(LEADING);
          sheet.text(line, sheet.layout.margin.left, SIZE.label, LABEL_FONT);
          sheet.y -= LEADING;
        }
        const lines = value ? wrapText(value, sheet.layout.contentWidth - 8, SIZE.body, VALUE_FONT) : [""];
        for (const line of lines) {
          sheet.ensure(LEADING);
          sheet.text(line, sheet.layout.margin.left + 4, SIZE.body, VALUE_FONT);
          sheet.line(sheet.layout.margin.left, sheet.y - 3, sheet.layout.margin.left + sheet.layout.contentWidth, sheet.y - 3);
          sheet.y -= LEADING;
        }
      } else {
        drawValueLine(sheet, block.field.label, value, sheet.layout.margin.left, sheet.layout.contentWidth);
        sheet.y -= LEADING;
      }
      sheet.y -= 4;
      break;
    }

    case "field_row": {
      sheet.ensure(LEADING + 8);
      const columnWidth = (sheet.layout.contentWidth - 20) / Math.max(1, block.fields.length);
      const startY = sheet.y;
      let lowest = startY;
      block.fields.forEach((field, index) => {
        sheet.y = startY;
        drawValueLine(
          sheet,
          field.label,
          values.values[field.key] ?? "",
          sheet.layout.margin.left + index * (columnWidth + 10),
          columnWidth,
        );
        lowest = Math.min(lowest, sheet.y);
      });
      sheet.y = lowest - LEADING - 2;
      break;
    }

    case "checkbox_group": {
      const selected = new Set(values.checked[block.key] ?? []);
      const columns = block.columns;
      const columnWidth = sheet.layout.contentWidth / columns;
      const boxSize = 8.5;

      for (let index = 0; index < block.options.length; index += columns) {
        const row = block.options.slice(index, index + columns);
        sheet.ensure(LEADING + 4);
        const rowY = sheet.y;
        let usedLines = 1;

        row.forEach((option, column) => {
          const x = sheet.layout.margin.left + column * columnWidth;
          sheet.y = rowY;
          sheet.box(x, sheet.y - 1, boxSize);
          if (selected.has(option.key)) sheet.tick(x, sheet.y - 1, boxSize);
          const lines = wrapText(
            option.label,
            columnWidth - boxSize - 14,
            SIZE.body,
            "regular",
          );
          lines.forEach((line, lineIndex) => {
            sheet.text(line, x + boxSize + 6, SIZE.body, "regular");
            if (lineIndex < lines.length - 1) sheet.y -= 11;
          });
          usedLines = Math.max(usedLines, lines.length);
        });

        sheet.y = rowY - LEADING - (usedLines - 1) * 11;
      }
      sheet.y -= 4;
      break;
    }

    case "numbered_list": {
      for (const line of wrapText(block.label, sheet.layout.contentWidth, SIZE.label, LABEL_FONT)) {
        sheet.ensure(LEADING);
        sheet.text(line, sheet.layout.margin.left, SIZE.label, LABEL_FONT);
        sheet.y -= LEADING;
      }
      sheet.y -= 2;

      /*
       * The reference forms draft the FIRST line and leave the rest ruled for
       * the conversation. A drafted value that arrives as several lines fills
       * downward; a single line fills only line 1. Either way every numbered
       * line is printed, because the blank ones are where the meeting happens.
       */
      const raw = values.values[block.key] ?? "";
      const entries = raw
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean);

      for (let index = 0; index < block.count; index += 1) {
        sheet.ensure(LEADING);
        const number = `${index + 1}.`;
        sheet.text(number, sheet.layout.margin.left + 6, SIZE.body, "regular");
        const textX = sheet.layout.margin.left + 26;
        const entry = entries[index] ?? "";
        if (entry) {
          const [first, ...rest] = wrapText(entry, sheet.layout.contentWidth - 32, SIZE.body, VALUE_FONT);
          sheet.text(first ?? "", textX, SIZE.body, VALUE_FONT);
          sheet.line(textX, sheet.y - 3, sheet.layout.margin.left + sheet.layout.contentWidth, sheet.y - 3);
          for (const line of rest) {
            sheet.y -= LEADING;
            sheet.ensure(LEADING);
            sheet.text(line, textX, SIZE.body, VALUE_FONT);
            sheet.line(textX, sheet.y - 3, sheet.layout.margin.left + sheet.layout.contentWidth, sheet.y - 3);
          }
        } else {
          sheet.line(textX, sheet.y - 3, sheet.layout.margin.left + sheet.layout.contentWidth, sheet.y - 3);
        }
        sheet.y -= LEADING + 2;
      }
      sheet.y -= 2;
      break;
    }

    case "signature_row": {
      /*
       * ALWAYS BLANK. Two ruled lines and their captions, and nothing that
       * could ever carry a value — a signature block has no field key at all,
       * so there is no path by which anything could be printed here.
       */
      const { margin, contentWidth } = sheet.layout;
      const signatureWidth = contentWidth * 0.58;
      const dateX = margin.left + signatureWidth + 20;

      if (sheet.layout.signatureLayout === "ruled") {
        /*
         * The Word source leaves a WRITING LINE above the rule and puts the
         * caption underneath it, so the rule is the line you sign on rather
         * than a underscore beneath a label. Same two columns either way.
         */
        sheet.ensure(46);
        sheet.y -= 16;
        sheet.line(margin.left, sheet.y, margin.left + signatureWidth, sheet.y, 0.5, "0");
        sheet.line(dateX, sheet.y, margin.left + contentWidth, sheet.y, 0.5, "0");
        sheet.y -= 12;
        sheet.text(block.label, margin.left, SIZE.label, "bold");
        sheet.text(block.dateLabel, dateX, SIZE.label, "bold");
        sheet.y -= 22;
        break;
      }

      sheet.ensure(34);
      sheet.line(margin.left, sheet.y, margin.left + signatureWidth, sheet.y, 0.8, "0.2");
      sheet.line(dateX, sheet.y, margin.left + contentWidth, sheet.y, 0.8, "0.2");
      sheet.y -= 11;
      sheet.text(block.label, margin.left, SIZE.small, "regular", "0.35 0.35 0.35");
      sheet.text(block.dateLabel, dateX, SIZE.small, "regular", "0.35 0.35 0.35");
      sheet.y -= 20;
      break;
    }

    case "page_break":
      sheet.newPage();
      break;

    case "reference": {
      sheet.ensure(30);
      sheet.text(block.label.toUpperCase(), sheet.layout.margin.left, SIZE.small, "bold", "0.3 0.3 0.3");
      sheet.y -= 14;
      for (const paragraph of block.body) {
        for (const line of wrapText(paragraph, sheet.layout.contentWidth - 12, SIZE.body, "regular")) {
          sheet.ensure(LEADING);
          sheet.text(line, sheet.layout.margin.left + 8, SIZE.body, "regular");
          sheet.y -= LEADING;
        }
        sheet.y -= 4;
      }
      sheet.y -= 2;
      break;
    }

    default: {
      // Exhaustiveness: a new block kind must be given a drawing, not skipped.
      const exhaustive: never = block;
      throw new Error(`No PDF drawing for block ${JSON.stringify(exhaustive)}`);
    }
  }

  void variant;
}

function drawFooter(sheet: Sheet, meta: RenderMeta): void {
  const total = sheet.pages.length;
  sheet.pages.forEach((page, index) => {
    /*
     * The separator is an ASCII bar, not a middot. No font is embedded, so a
     * middot printed as "?" on the first proof — a small thing that made a
     * finished-looking document look broken.
     */
    const left = [
      meta.templateName,
      meta.employeeName,
      meta.formDate,
      meta.status === "draft" ? "DRAFT" : null,
    ]
      .filter(Boolean)
      .join("  |  ");
    const right = `Template v${meta.templateVersion}${meta.reference ? `  |  ${meta.reference}` : ""}  |  Page ${index + 1} of ${total}`;

    page.ops.push({
      draw: `BT 0.45 0.45 0.45 rg /F1 ${SIZE.footer} Tf 1 0 0 1 ${sheet.layout.margin.left} 36 Tm (${escapeText(left)}) Tj ET`,
    });
    const width = textWidth(right, SIZE.footer);
    page.ops.push({
      draw: `BT 0.45 0.45 0.45 rg /F1 ${SIZE.footer} Tf 1 0 0 1 ${(PAGE.width - sheet.layout.margin.right - width).toFixed(2)} 36 Tm (${escapeText(right)}) Tj ET`,
    });
    page.ops.push({
      draw: `0.8 G 0.5 w ${sheet.layout.margin.left} 48 m ${PAGE.width - sheet.layout.margin.right} 48 l S`,
    });
  });
}

/* ------------------------------------------------------------ assembly --- */

/**
 * Assembles the file.
 *
 * BYTES, NOT A STRING. Everything a form draws used to be ASCII, so the whole
 * document could be built up as text and encoded once at the end. An image
 * stream is arbitrary binary and would be mangled by UTF-8 encoding, so the
 * document is now assembled as byte chunks and the ASCII parts are encoded on
 * the way in. Same output for a form with no images, down to the byte.
 */
function pdfFrom(pages: Page[], images: PlacedImage[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;

  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    length += bytes.byteLength;
  };
  const push = (text: string) => pushBytes(encoder.encode(text));
  const object = (index: number, body: string) => {
    offsets[index] = length;
    push(`${index} 0 obj\n${body}\nendobj\n`);
  };
  /** An object whose stream body is binary rather than text. */
  const streamObject = (index: number, dictionary: string, stream: Uint8Array) => {
    offsets[index] = length;
    push(`${index} 0 obj\n<< ${dictionary} /Length ${stream.byteLength} >>\nstream\n`);
    pushBytes(stream);
    push("\nendstream\nendobj\n");
  };

  push("%PDF-1.4\n");

  const pageIds = pages.map((_, index) => 4 + index * 2);
  const catalogId = 1;
  const pagesId = 2;
  const fontRegularId = 3;
  const fontBoldId = 4 + pages.length * 2;
  const imageIds = images.map((_, index) => fontBoldId + 1 + index);
  /*
   * Images are placed on the FIRST page only — a letterhead mark, not a
   * repeating watermark — so only that page declares them as resources.
   */
  const xobjects = images.length
    ? ` /XObject << ${images.map((image, index) => `${image.id} ${imageIds[index]} 0 R`).join(" ")} >>`
    : "";

  object(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  object(
    pagesId,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  object(fontRegularId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  pages.forEach((page, index) => {
    const contentId = pageIds[index] + 1;
    /*
     * Images go down FIRST, so type and rules always sit on top of the mark
     * rather than under it. `cm` scales the unit square the image occupies to
     * the size and position it was placed at.
     */
    const drawn = index === 0 ? images : [];
    const stream = [
      ...drawn.map(
        (image) =>
          `q ${image.drawWidth.toFixed(2)} 0 0 ${image.drawHeight.toFixed(2)} ${image.x.toFixed(2)} ${image.y.toFixed(2)} cm ${image.id} Do Q`,
      ),
      ...page.ops.map((op) => op.draw),
    ].join("\n");
    object(
      pageIds[index],
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
        `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >>${index === 0 ? xobjects : ""} >> ` +
        `/Contents ${contentId} 0 R >>`,
    );
    object(contentId, `<< /Length ${encoder.encode(stream).byteLength} >>\nstream\n${stream}\nendstream`);
  });

  object(fontBoldId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  images.forEach((image, index) => {
    const compressed = Uint8Array.from(deflateSync(Buffer.from(image.rgb)));
    streamObject(
      imageIds[index],
      `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`,
      compressed,
    );
  });

  const xrefOffset = length;
  const maxId = imageIds.length > 0 ? imageIds[imageIds.length - 1] : fontBoldId;
  const entries = ["0000000000 65535 f \n"];
  for (let id = 1; id <= maxId; id += 1) {
    const offset = offsets[id] ?? 0;
    entries.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  push(`xref\n0 ${maxId + 1}\n${entries.join("")}`);
  push(`trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const file = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    file.set(chunk, at);
    at += chunk.byteLength;
  }
  return file;
}

/**
 * Renders one form to a PDF.
 *
 * Everything printed comes from the template version, the chosen variant and
 * the stored values — never from the editor's own furniture. A draft is watermarked
 * in the footer rather than being refused, because a manager taking a printed
 * draft into a conversation is exactly how these forms get completed.
 */
export function renderFormPdf(
  document: FormDocument,
  variant: FormVariant | null,
  values: RenderValues,
  meta: RenderMeta,
): Uint8Array {
  const sheet = new Sheet(layoutFor(document.style));

  /*
   * THE LOGO IS ANCHORED TO THE PAGE, NOT TO A BLOCK — which is exactly how the
   * Word source anchors it, and why it stays in the corner however the content
   * above it flows. It is resolved through the approved asset registry: a
   * version names a key, and a key that resolves to nothing prints no logo
   * rather than failing the download.
   */
  placeLogo(sheet, document.style);

  const blocks = renderDocument(document, variant);
  for (const block of blocks) {
    drawBlock(sheet, block, values, variant);
  }

  drawFooter(sheet, meta);
  return pdfFrom(sheet.pages, sheet.images);
}

function placeLogo(sheet: Sheet, style: FormDocumentStyle | undefined): void {
  const logo = style?.logo;
  if (!logo) return;

  const asset = resolveImageAsset(logo.assetKey);
  if (!asset) return;

  let decoded;
  try {
    decoded = decodePng(imageAssetBytes(asset));
  } catch {
    // A logo that will not decode must never cost a manager their document.
    return;
  }

  const drawWidth = logo.widthPt;
  const drawHeight = (decoded.height / decoded.width) * drawWidth;
  const { margin } = sheet.layout;

  sheet.place({
    width: decoded.width,
    height: decoded.height,
    rgb: decoded.rgb,
    // Top-right: hard against the top edge and inset from the right, matching
    // the anchor the source document uses.
    x: PAGE.width - margin.right * 0.45 - drawWidth,
    y: PAGE.height - drawHeight,
    drawWidth,
    drawHeight,
  });
}

/** A filename a manager can find again: form, employee, date. */
export function pdfFileName(meta: RenderMeta): string {
  const safe = (value: string) =>
    asciiOnly(value)
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  return `${safe(meta.templateName)}-${safe(meta.employeeName)}-${safe(meta.formDate)}.pdf`;
}

/** Resolves a document title for a variant, for the download and the header. */
export function documentTitle(
  document: FormDocument,
  variant: FormVariant | null,
): string {
  const letterhead = document.blocks.find((block) => block.kind === "letterhead");
  if (letterhead && letterhead.kind === "letterhead") {
    return interpolate(letterhead.title, variant);
  }
  return "Form";
}
