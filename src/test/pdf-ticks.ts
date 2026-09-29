/**
 * Which answers of a printed checkbox question carry a tick.
 *
 * A tick is drawn as strokes, not text, so a text extractor cannot see it. This
 * reads the renderer's (uncompressed) content stream instead: the question's
 * own line, the option labels printed on that row, and the two-stroke tick
 * (`0 G 1.3 w … m … l S … m … l S`) inside the box just left of each label.
 *
 * Geometry is `pdf-render.ts`'s: a box of 8.5pt sits 6pt left of its label and
 * 1pt below the text line, and a tick is inset 22% of the box.
 */

interface DrawnText {
  page: number;
  x: number;
  y: number;
  text: string;
}

interface DrawnTick {
  page: number;
  x: number;
  y: number;
}

const BOX = 8.5;
const GAP = 6;
const PAD = BOX * 0.22;

function streams(bytes: Uint8Array): string[] {
  const source = Buffer.from(bytes).toString("latin1");
  return source
    .split("stream\n")
    .slice(1)
    .map((chunk) => chunk.split("\nendstream")[0]!);
}

function drawnText(bytes: Uint8Array): DrawnText[] {
  const found: DrawnText[] = [];
  streams(bytes).forEach((body, page) => {
    const pattern =
      /BT [\d.]+ [\d.]+ [\d.]+ rg \/F\d ([\d.]+) Tf 1 0 0 1 ([-\d.]+) ([-\d.]+) Tm \((.*?)\) Tj ET/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body))) {
      found.push({
        page,
        x: Number(match[2]),
        y: Number(match[3]),
        text: match[4]!.replace(/\\([\\()])/g, "$1"),
      });
    }
  });
  return found;
}

function drawnTicks(bytes: Uint8Array): DrawnTick[] {
  const found: DrawnTick[] = [];
  streams(bytes).forEach((body, page) => {
    const pattern = /0 G 1\.3 w ([-\d.]+) ([-\d.]+) m [-\d.]+ [-\d.]+ l S [-\d.]+ [-\d.]+ m [-\d.]+ [-\d.]+ l S/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body))) {
      found.push({ page, x: Number(match[1]), y: Number(match[2]) });
    }
  });
  return found;
}

/**
 * The options printed beside `question`, each with whether its box is ticked.
 * Throws when the question is not on the page, so a missing question can never
 * read as "nothing ticked".
 */
export function answersBeside(
  bytes: Uint8Array,
  question: string,
  options: readonly string[],
): { label: string; ticked: boolean }[] {
  const text = drawnText(bytes);
  const ticks = drawnTicks(bytes);
  const line = text.find((entry) => entry.text === question);
  if (!line) throw new Error(`"${question}" is not printed`);

  return options.map((label) => {
    const option = text.find(
      (entry) =>
        entry.page === line.page &&
        entry.text === label &&
        Math.abs(entry.y - line.y) < 3 &&
        entry.x > line.x,
    );
    if (!option) throw new Error(`"${label}" is not printed beside "${question}"`);
    const boxX = option.x - GAP - BOX;
    const boxY = option.y - 1;
    const ticked = ticks.some(
      (tick) =>
        tick.page === option.page &&
        Math.abs(tick.x - (boxX + PAD)) < 1 &&
        Math.abs(tick.y - (boxY + PAD)) < 1,
    );
    return { label, ticked };
  });
}
