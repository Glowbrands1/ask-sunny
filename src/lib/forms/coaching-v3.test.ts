import { createHash } from "node:crypto";
import { getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";

import { imageAssetBytes, resolveImageAsset } from "./assets";
import { parseFormDocument, type FormDocument } from "./document";
import { TEMPLATE_SEEDS, coachingDocument } from "./library";
import { renderFormPdf, type RenderMeta } from "./pdf-render";
import { decodePng } from "./png";

/**
 * ============================================================================
 * THE COACHING FORM AGAINST THE WORD DOCUMENT THE BUSINESS ISSUES
 * ============================================================================
 *
 * The authoritative source is `01.) Coaching Form.docx`. Its layout was measured
 * out of the package and out of the PDF exported from it, and the numbers below
 * are those measurements — not this renderer's own output written down after
 * the fact:
 *
 *   page            US Letter, 612 x 792pt, portrait, 1in margins
 *   masthead        "Coaching Form" over "Sun Tan City", centred
 *   logo            1.06 x 0.95in, top right, hard against the top edge
 *   headings        five, centred, each over a hairline rule ~0.5pt tall
 *   section bars    NONE. The Word document has no filled heading bands.
 *   signatures      a rule with its caption UNDERNEATH it
 *
 * THE NEGATIVE ASSERTIONS ARE THE POINT. A black bar, a missing logo or a
 * second page are each a form that does not look like the one the business
 * signs, and each is something this renderer did before the versioned style
 * existed — so each is checked for by absence, on the rendered bytes.
 */

const META: RenderMeta = {
  templateName: "Coaching Form",
  templateVersion: 3,
  employeeName: "Sarah Test",
  formDate: "2026-09-08",
  locationName: "Sun Tan City - Test Salon",
  reference: "qa-v3",
  status: "draft",
};

/** The synthetic case the brief names: Underperformance, Other = Punctuality. */
const VALUES = {
  values: {
    employee_name: "Sarah Test",
    form_date: "2026-09-08",
    job_title: "Tanning Consultant",
    location: "Sun Tan City - Test Salon",
    other_topic: "Punctuality",
    coaching_details:
      "Observed:\nSarah arrived late for her scheduled shift today.\n\nExpectation:\nSarah is expected to arrive on time for every scheduled shift.",
  },
  checked: { coaching_type: ["underperformance"], coaching_topics: ["other"] },
};

/* --------------------------------------------------- reading the output --- */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  painted: string;
}

interface Placement {
  key: string;
  sourceWidth: number;
  sourceHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Line {
  y: number;
  x0: number;
  x1: number;
  text: string;
  /** Point size of the first run, and whether it is set in the bold face. */
  size: number;
  bold: boolean;
}

/**
 * Replays the page's content stream, which is the only way to see what was
 * actually drawn rather than what the code meant to draw.
 */
async function readPage(bytes: Uint8Array, index = 0) {
  const pdf = await getDocumentProxy(bytes);
  const page = await pdf.getPage(index + 1);
  const { OPS } = await import("unpdf/pdfjs");
  const names: Record<number, string> = {};
  for (const [name, code] of Object.entries(OPS)) names[code as number] = name;

  const multiply = (a: number[], b: number[]) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const apply = (m: number[], x: number, y: number) => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];

  const operators = await page.getOperatorList();
  const rects: Rect[] = [];
  const images: Placement[] = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];

  for (let i = 0; i < operators.fnArray.length; i += 1) {
    const name = names[operators.fnArray[i]];
    const args = operators.argsArray[i] as never as number[] & { [k: number]: never };

    if (name === "save") stack.push(matrix.slice());
    else if (name === "restore") matrix = stack.pop() ?? matrix;
    else if (name === "transform") matrix = multiply(matrix, args as unknown as number[]);
    else if (name === "paintImageXObject") {
      const key = (args as unknown as string[])[0];
      const image = (await new Promise((resolve) => page.objs.get(key, resolve))) as {
        width: number;
        height: number;
      };
      const [x, y] = apply(matrix, 0, 0);
      images.push({
        key,
        sourceWidth: image.width,
        sourceHeight: image.height,
        x,
        y,
        width: Math.hypot(matrix[0], matrix[1]),
        height: Math.hypot(matrix[2], matrix[3]),
      });
    } else if (name === "constructPath") {
      const raw = args as unknown as [number, unknown, number[]];
      const painted = names[raw[0]];
      if (painted === "clip" || painted === "eoClip") continue;
      const box = raw[2];
      const [x0, y0] = apply(matrix, box[0], box[1]);
      const [x1, y1] = apply(matrix, box[2], box[3]);
      rects.push({
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
        painted,
      });
    }
  }

  const content = await page.getTextContent();
  /*
   * The FONT of a run is what tells the two signature treatments apart: the
   * default draws its captions small and grey, the Word source's draws them at
   * body size in the bold face. Only two fonts are ever embedded — /F1
   * Helvetica and /F2 Helvetica-Bold — and the bold one is the first the
   * renderer declares, so it is the lower-numbered of the two names.
   */
  const fonts = new Set<string>();
  for (const item of content.items as { str: string; fontName: string }[]) {
    if (item.str.trim()) fonts.add(item.fontName);
  }
  const boldFont = [...fonts].sort()[0];

  const rows = new Map<
    number,
    { x: number; width: number; str: string; size: number; font: string }[]
  >();
  for (const item of content.items as {
    str: string;
    width: number;
    height: number;
    fontName: string;
    transform: number[];
  }[]) {
    if (!item.str.trim()) continue;
    const y = Math.round(item.transform[5] * 2) / 2;
    if (!rows.has(y)) rows.set(y, []);
    rows
      .get(y)!
      .push({ x: item.transform[4], width: item.width, str: item.str, size: item.height, font: item.fontName });
  }
  const lines: Line[] = [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, items]) => {
      const sorted = items.sort((a, b) => a.x - b.x);
      const last = sorted[sorted.length - 1];
      return {
        y,
        x0: sorted[0].x,
        x1: last.x + last.width,
        text: sorted.map((entry) => entry.str).join(""),
        size: sorted[0].size,
        bold: sorted[0].font === boldFont,
      };
    });

  return { pages: pdf.numPages, rects, images, lines };
}

const lineFor = (lines: Line[], text: string) => {
  const found = lines.find((line) => line.text.replace(/\s+/g, " ").includes(text));
  if (!found) throw new Error(`no line containing ${JSON.stringify(text)}`);
  return found;
};

/** Filled bands: the black section bars. Hairline rules are under 2pt. */
const bands = (rects: Rect[]) =>
  rects.filter((rect) => rect.painted !== "stroke" && rect.height > 2 && rect.width > 100);

/** The thin filled rules the Word source draws under each heading. */
const hairlines = (rects: Rect[]) =>
  rects.filter(
    (rect) => rect.painted !== "stroke" && rect.height > 0 && rect.height <= 2 && rect.width > 300,
  );

const SECTIONS = [
  "Employee Information",
  "Type of Coaching",
  "Topic of Coaching",
  "Details of Coaching",
  "Acknowledgement of Coaching",
];

/* ========================================================== the content === */

describe("Coaching v3 content matches the Word source", () => {
  const document = coachingDocument();
  const group = (key: string) => {
    const found = document.blocks.find(
      (block) => block.kind === "checkbox_group" && block.key === key,
    );
    if (found?.kind !== "checkbox_group") throw new Error(`no group ${key}`);
    return found;
  };

  it("has exactly the source's three types of coaching", () => {
    expect(group("coaching_type").options.map((option) => option.label)).toEqual([
      "Underperformance",
      "Training Plan of Action",
      "Retraining",
    ]);
  });

  it("has exactly the source's eleven topics, in the source's order", () => {
    expect(group("coaching_topics").options.map((option) => option.label)).toEqual([
      "Store Tours",
      "Engaging Conversation",
      "Engaging Questions",
      "Relevant Recommendations",
      "Overcoming Objections",
      "Product Basics",
      "Completing the Engagement",
      "Sales Strategies/Upselling",
      "Cleaning Tasks",
      "New Client Documents",
      "Other",
    ]);
  });

  it("does not make Punctuality a permanent checkbox", () => {
    // It is a write-in under Other, which is what the source provides for.
    const labels = group("coaching_topics").options.map((option) => option.label.toLowerCase());
    expect(labels).not.toContain("punctuality");
    expect(JSON.stringify(document).toLowerCase()).not.toContain("punctuality");

    const other = document.blocks.find(
      (block) => block.kind === "field" && block.field.key === "other_topic",
    );
    expect(other).toBeDefined();
  });

  it("keeps none of the retired v1 topics", () => {
    const json = JSON.stringify(document).toLowerCase();
    for (const retired of ["salon_tours", "memberships", "lotion", "upgrades"]) {
      expect(json).not.toContain(retired);
    }
  });

  it("carries the acknowledgement sentence exactly", () => {
    const acknowledgement = document.blocks.find((block) => block.kind === "acknowledgement");
    expect(acknowledgement).toEqual({
      kind: "acknowledgement",
      text: "I confirm that my supervisor and I have discussed this training and plan for improvement.",
    });
  });

  it("keeps both signature rows, with their date captions", () => {
    const signatures = document.blocks.filter((block) => block.kind === "signature_row");
    expect(signatures).toEqual([
      { kind: "signature_row", label: "Employee Signature", dateLabel: "Date" },
      { kind: "signature_row", label: "Supervisor Signature", dateLabel: "Date" },
    ]);
  });

  it("has the source's five sections, in the source's order", () => {
    const labels = document.blocks
      .filter((block) => block.kind === "section")
      .map((block) => (block.kind === "section" ? block.label : ""));
    expect(labels).toEqual(SECTIONS);
  });

  it("names the employee information fields the way the source does", () => {
    const rows = document.blocks.filter((block) => block.kind === "field_row");
    const labels = rows.flatMap((row) => (row.kind === "field_row" ? row.fields : [])).map((f) => f.label);
    expect(labels).toEqual(["Name", "Date", "Job Title", "Location"]);
  });

  it("survives being stored and read back with its style intact", () => {
    const stored = parseFormDocument(JSON.parse(JSON.stringify(document)));
    expect(stored.style).toEqual(document.style);
    expect(stored.style?.logo?.assetKey).toBe("sun-tan-city");
  });
});

/* ============================================================ the asset === */

describe("the logo is the one embedded in the Word document", () => {
  const asset = resolveImageAsset("sun-tan-city");

  it("resolves, and its bytes hash to the digest taken from the .docx", () => {
    expect(asset).not.toBeNull();
    const bytes = imageAssetBytes(asset!);
    /*
     * This digest was computed from `word/media/image1.png` inside
     * `01.) Coaching Form.docx`. If these bytes are ever swapped, re-encoded or
     * "optimised", this fails — which is the point: nobody should be able to
     * change the logo on a signed HR record without the suite saying so.
     */
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "3014f7d7c48a39ef701346139fa24b13cf80aedd107b85538f6183d4bb7b05c3",
    );
  });

  it("is the full-resolution original, not the PDF's downsample", () => {
    // The exported PDF carries a 198x180 copy; the Word package has 317x284.
    expect(asset!.width).toBe(317);
    expect(asset!.height).toBe(284);
    const decoded = decodePng(imageAssetBytes(asset!));
    expect([decoded.width, decoded.height]).toEqual([317, 284]);
  });

  it("decodes to a mark that is mostly dark on a white ground", () => {
    /*
     * A cheap shape check that a garbled decode cannot pass. The logo is a black
     * rounded square with white type, so the centre must be dark and the very
     * corner — outside the rounding, transparent in the source — must be white.
     */
    const image = decodePng(imageAssetBytes(asset!));
    const at = (x: number, y: number) => {
      const i = (y * image.width + x) * 3;
      return (image.rgb[i] + image.rgb[i + 1] + image.rgb[i + 2]) / 3;
    };
    expect(at(4, 4)).toBeGreaterThan(200);
    expect(at(image.width - 5, 4)).toBeGreaterThan(200);
    expect(at(Math.floor(image.width / 2), 20)).toBeLessThan(60);
  });
});

/* =========================================================== the render === */

describe("the printed Coaching v3", () => {
  const document = parseFormDocument(JSON.parse(JSON.stringify(coachingDocument())));
  const render = () => renderFormPdf(document, null, VALUES, META);

  it("fits an ordinary coaching conversation on one Letter page", async () => {
    const page = await readPage(render());
    expect(page.pages).toBe(1);
  });

  it("carries the exact logo, in the top right, against the top edge", async () => {
    const page = await readPage(render());
    expect(page.images).toHaveLength(1);
    const [logo] = page.images;

    // The bitmap that reached the file is the full-resolution original.
    expect([logo.sourceWidth, logo.sourceHeight]).toEqual([317, 284]);

    // 1.06 x 0.95in in the source; within a point of it here.
    expect(logo.width).toBeCloseTo(76, 0);
    expect(logo.height).toBeCloseTo(68.1, 0);

    // Top right: past the horizontal middle, and touching the top of the sheet.
    expect(logo.x).toBeGreaterThan(612 / 2);
    expect(logo.x + logo.width).toBeLessThanOrEqual(612);
    expect(logo.x + logo.width).toBeGreaterThan(612 - 45);
    expect(logo.y + logo.height).toBeCloseTo(792, 0);
  });

  it("has NO black section bars", async () => {
    const page = await readPage(render());
    expect(bands(page.rects)).toHaveLength(0);
  });

  it("rules each of the five headings with a hairline instead", async () => {
    const page = await readPage(render());
    const rules = hairlines(page.rects);
    expect(rules).toHaveLength(SECTIONS.length);

    for (const rule of rules) {
      expect(rule.height).toBeLessThanOrEqual(1);
      // Full content width on a 1in page: 612 - 72 - 72.
      expect(rule.x).toBeCloseTo(72, 0);
      expect(rule.width).toBeCloseTo(468, 0);
    }
  });

  it("centres every heading, and puts each rule directly beneath it", async () => {
    const page = await readPage(render());
    const rules = hairlines(page.rects).sort((a, b) => b.y - a.y);

    SECTIONS.forEach((label, index) => {
      const line = lineFor(page.lines, label);
      expect((line.x0 + line.x1) / 2).toBeCloseTo(306, 0);
      // The rule for this heading sits just below its baseline.
      expect(rules[index].y).toBeLessThan(line.y);
      expect(line.y - rules[index].y).toBeLessThan(14);
    });
  });

  it("stacks the masthead, centred, above everything else", async () => {
    const page = await readPage(render());
    const title = lineFor(page.lines, "Coaching Form");
    const brand = lineFor(page.lines, "Sun Tan City");

    expect((title.x0 + title.x1) / 2).toBeCloseTo(306, 0);
    expect((brand.x0 + brand.x1) / 2).toBeCloseTo(306, 0);
    expect(title.y).toBeGreaterThan(brand.y);
    expect(brand.y).toBeGreaterThan(lineFor(page.lines, "Employee Information").y);
  });

  it("prints the filled content, including the Other write-in", async () => {
    const page = await readPage(render());
    const text = page.lines.map((line) => line.text).join("\n");

    expect(text).toContain("Sarah Test");
    expect(text).toContain("Punctuality");
    expect(text).toContain("Observed:");
    expect(text).toContain("Expectation:");
    expect(text).toContain(
      "I confirm that my supervisor and I have discussed this training and plan",
    );
  });

  it("sets the signature captions the way the source does, beneath their rules", async () => {
    /*
     * BOTH treatments put a rule above the caption, so position alone cannot
     * tell them apart — and a test that only checked position passed a
     * deliberately broken renderer. What differs is the TYPE and the ROOM: the
     * default prints small grey captions on a tight block; the Word source
     * prints them at body size in bold, over a rule with real writing space
     * above it.
     */
    const page = await readPage(render());
    const rules: number[] = [];

    for (const caption of ["Employee Signature", "Supervisor Signature"]) {
      const line = lineFor(page.lines, caption);
      expect(line.size).toBeCloseTo(10, 0);
      expect(line.bold).toBe(true);

      const rule = page.rects
        .filter((rect) => rect.painted === "stroke" && rect.x < 100 && rect.y > line.y)
        .sort((a, b) => a.y - b.y)[0];
      expect(rule).toBeDefined();
      expect(rule.y - line.y).toBeLessThan(20);
      rules.push(rule.y);
    }

    // Room to sign on: the two signature blocks stand well apart, as they do on
    // the source page. The tight default puts barely thirty points between them.
    expect(rules[0] - rules[1]).toBeGreaterThan(40);
  });

  it("leaves a real writing area for the details", async () => {
    const page = await readPage(render());
    const details = page.rects.filter(
      (rect) => rect.painted === "stroke" && rect.width > 400 && rect.height < 1,
    );
    // The long-text field rules every line it prints, so several full-width
    // writing lines is what "a large Details area" looks like in the output.
    expect(details.length).toBeGreaterThanOrEqual(4);
  });

  it("respects the 1in page the source is laid out on", async () => {
    const page = await readPage(render());
    expect(lineFor(page.lines, "Sarah Test").x0).toBeCloseTo(72, 0);
  });
});

/* ================================================ the rest of the library === */

describe("no other template is touched by any of this", () => {
  const others = TEMPLATE_SEEDS.filter((seed) => seed.key !== "coaching");

  it("covers the rest of the library", () => {
    expect(others.length).toBeGreaterThanOrEqual(11);
  });

  it("leaves every other template with no style at all", () => {
    for (const seed of others) {
      expect((seed.document as FormDocument).style).toBeUndefined();
      expect(parseFormDocument(JSON.parse(JSON.stringify(seed.document))).style).toBeUndefined();
    }
  });

  it("keeps the black section bars on every other template", async () => {
    for (const seed of others) {
      const document = parseFormDocument(JSON.parse(JSON.stringify(seed.document)));
      const variant = seed.variants?.[0] ?? null;
      const bytes = renderFormPdf(document, variant ?? null, { values: {}, checked: {} }, {
        ...META,
        templateName: seed.name,
      });
      const page = await readPage(bytes);

      const sectionCount = document.blocks.filter((block) => block.kind === "section").length;
      if (sectionCount === 0) continue;

      // Still bars, still no logo — the defaults did not move.
      expect(bands(page.rects).length).toBeGreaterThan(0);
      expect(page.images).toHaveLength(0);
    }
  });
});
