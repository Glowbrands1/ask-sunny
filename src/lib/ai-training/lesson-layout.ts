import { parseTrainingMarkdown, plainText, type MdBlock, type RichText } from "./markdown";

/**
 * A LESSON'S TEXT, SORTED INTO THE PAGE'S FOUR BLOCKS — Objective, Learn,
 * Practice, Submit (Pau's lesson-page layout, 20 Nov 2026).
 *
 * The lesson text is NOT changed: this only decides which block each part of
 * the stored markdown is drawn in. The lessons come in two shapes, both pasted
 * from Notion:
 *
 *   older  — 🎓 intro, "## 📺 This Lesson's Lesson", "## Objective" and
 *            "## Why This Matters" (each wrapped in a 💡 callout), "## This
 *            Lesson's Assignment" with "### Step N: …", then "## Expectation
 *            (Required Submission)".
 *   newer  — 🎓 intro, "## 🎯 Objective", "## 📺 Learn", "## 🛠️ Practice" with
 *            "**Step N: …**" paragraphs, then "## 📤 Submit".
 *
 * Any other section ("Rules for This Lesson", "What Doesn't Come With You")
 * stays in Practice, before or after the steps as it was written. A lesson
 * without an Objective, a Practice and a Submit section (the archived ones)
 * returns null and is drawn as one card, as before.
 *
 * Pure and isomorphic: the screen parses on the server and in the browser, and
 * block ids are numbered per parse, so both give the same ids.
 */

export type LessonSectionKind = "objective" | "learn" | "why" | "practice" | "submit" | "end" | "other";

export interface LessonStep {
  /** "Step" or "Part", as the lesson writes it. */
  word: string;
  /** The number written in the lesson ("Step 3"); ChatGPT Lesson 3's parts start at 2 when Part 1 is not bold. */
  number: number;
  title: RichText[];
  blocks: MdBlock[];
}

export interface LessonNote {
  /** The section's own heading block, drawn with its content. */
  blocks: MdBlock[];
}

export interface LessonLayout {
  /** The intro's first paragraph — the line under the title. */
  lede: RichText[] | null;
  /** The rest of the intro, read before "Why this matters". */
  introRest: MdBlock[];
  /** Notices before the first section (📌 Before you start, 🔄 Updated). */
  notices: MdBlock[];
  objective: MdBlock[];
  /** "Budget 45 minutes" → 45, when the lesson says so. */
  minutes: number | null;
  learn: MdBlock[];
  /** The first web link in Learn — the video or course lesson to open. */
  learnHref: string | null;
  why: MdBlock[];
  practice: {
    intro: MdBlock[];
    steps: LessonStep[];
    after: MdBlock[];
  };
  submit: {
    intro: MdBlock[];
    checklist: MdBlock[];
    after: MdBlock[];
  };
  /** Anything after "Learning In Action". */
  tail: MdBlock[];
  /** Every block id in Practice, for its quoted prompts' Copy buttons. */
  practiceIds: Set<string>;
}

/** A heading's words without its emoji and markup: "📺 This Lesson's Lesson" → "This Lesson's Lesson". */
export function headingWords(runs: RichText[] | undefined): string {
  return plainText(runs)
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sectionKind(title: string): LessonSectionKind {
  const t = title.replace(/’/g, "'");
  if (/^objective\b/i.test(t)) return "objective";
  if (/^(learn|this (lesson|week)'?s lesson|watch)\b/i.test(t)) return "learn";
  if (/^(why this matters|the problem)\b/i.test(t)) return "why";
  if (/^(practice|this (lesson|week)'?s assignment|assignment)\b/i.test(t)) return "practice";
  if (/^(submit|expectation|required submission)\b/i.test(t)) return "submit";
  if (/^learning in action\b/i.test(t)) return "end";
  return "other";
}

const isSectionHeading = (b: MdBlock | undefined) => b?.type === "heading_1" || b?.type === "heading_2";

/**
 * Where a top-level block starts a section: a "##" heading, or a callout that
 * holds one (the older lessons wrap their headings in 💡 callouts). A named
 * section's heading is a marker and is not drawn (the block's chip says it);
 * an "other" section's heading is, and a callout with more in it than its
 * heading ("🔒 Rules for This Lesson" and its list) is drawn whole.
 */
function sectionStart(block: MdBlock): { kind: LessonSectionKind; content: MdBlock[] } | null {
  if (isSectionHeading(block)) {
    // The block's chip names Objective, Learn, Practice and Submit; an "other" section keeps its heading.
    const kind = sectionKind(headingWords(block.text));
    return { kind, content: kind === "other" ? [block] : [] };
  }
  if (block.type === "callout" && isSectionHeading(block.children?.[0])) {
    const heading = block.children![0];
    const kind = sectionKind(headingWords(heading.text));
    if (block.children!.length === 1) return { kind, content: kind === "other" ? [heading] : [] };
    // A callout with a named section and more inside it is content; only "other" sections are drawn that way.
    return kind === "other" ? { kind, content: [block] } : null;
  }
  return null;
}

const STEP_RE = /^(?:🔹\s*)?(step|part)\s+(\d+)\s*[:.—–-]?\s*/i;

/** A paragraph that is all emphasis, led by bold: "**Part 1: Quick-Fire Challenges** *(do each one)*". */
function boldParagraph(block: MdBlock): boolean {
  const runs = (block.text ?? []).filter((r) => r.text.trim());
  return block.type === "paragraph" && runs.length > 0 && !!runs[0].bold && runs.every((r) => r.bold || r.italic);
}

/** "### Step 2: Build Something Real" or a bold "Step 2: …" paragraph. */
function stepStart(block: MdBlock): { word: string; number: number; title: RichText[] } | null {
  if (!/^heading_[123]$/.test(block.type) && !boldParagraph(block)) return null;
  const text = plainText(block.text);
  const m = STEP_RE.exec(text.trim());
  if (!m) return null;
  // Drop the "Step 2: " prefix from the runs, keeping their styling.
  let skip = text.indexOf(m[0]) + m[0].length;
  const title: RichText[] = [];
  for (const run of block.text ?? []) {
    if (skip >= run.text.length) {
      skip -= run.text.length;
      continue;
    }
    title.push({ ...run, text: run.text.slice(skip), bold: false });
    skip = 0;
  }
  const word = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return { word, number: Number(m[2]), title };
}

/** Notes that close the step list when they follow the last step: tailor-it-to-your-role, privacy, pinned. */
const AFTER_STEPS_ICONS = new Set(["🧩", "🔒", "📌", "⚠️"]);

function splitSteps(blocks: MdBlock[]): LessonLayout["practice"] {
  const intro: MdBlock[] = [];
  const steps: LessonStep[] = [];
  for (const block of blocks) {
    const start = stepStart(block);
    if (start) {
      steps.push({ word: start.word, number: start.number || steps.length + 1, title: start.title, blocks: [] });
      continue;
    }
    if (steps.length) steps[steps.length - 1].blocks.push(block);
    else intro.push(block);
  }
  const after: MdBlock[] = [];
  const last = steps[steps.length - 1];
  if (last) {
    const cut = last.blocks.findIndex((b) => b.type === "callout" && AFTER_STEPS_ICONS.has(b.icon ?? ""));
    if (cut >= 0) after.push(...last.blocks.splice(cut));
  }
  return { intro, steps, after };
}

function splitSubmit(blocks: MdBlock[]): LessonLayout["submit"] {
  const first = blocks.findIndex((b) => b.type === "to_do");
  if (first < 0) return { intro: blocks, checklist: [], after: [] };
  let end = first;
  while (end < blocks.length && blocks[end].type === "to_do") end++;
  return { intro: blocks.slice(0, first), checklist: blocks.slice(first, end), after: blocks.slice(end) };
}

/** "Budget 45 minutes", "about 30 min", "takes 20–30 minutes" → the first figure. */
export function lessonMinutes(blocks: MdBlock[]): number | null {
  const text = textOf(blocks);
  const m = /\b(?:budget|about|takes?|plan (?:on|for))\s+(?:about\s+)?(\d{1,3})(?:\s*[–-]\s*\d{1,3})?\s*min/i.exec(text);
  return m ? Number(m[1]) : null;
}

function textOf(blocks: MdBlock[]): string {
  return blocks
    .map((b) => [plainText(b.text), b.children ? textOf(b.children) : ""].join("\n"))
    .join("\n");
}

function firstWebLink(blocks: MdBlock[]): string | null {
  for (const block of blocks) {
    for (const run of block.text ?? []) if (run.href && /^https?:\/\//i.test(run.href)) return run.href;
    const inner = block.children ? firstWebLink(block.children) : null;
    if (inner) return inner;
  }
  return null;
}

/** Ids of every block in Practice, nested ones too — except inside intro callouts (🎓 💡 🔒), as before. */
function collectIds(blocks: MdBlock[], into: Set<string>) {
  for (const block of blocks) {
    if (block.type !== "code") into.add(block.id);
    const intro = block.type === "callout" && ["🎓", "💡", "🔒"].includes(block.icon ?? "");
    if (block.children && !intro) collectIds(block.children, into);
  }
}

const dropDividers = (blocks: MdBlock[]) => blocks.filter((b) => b.type !== "divider");

export function lessonLayout(md: string): LessonLayout | null {
  return layoutFromBlocks(parseTrainingMarkdown(md));
}

export function layoutFromBlocks(blocks: MdBlock[]): LessonLayout | null {
  const leading: MdBlock[] = [];
  const sections: { kind: LessonSectionKind; blocks: MdBlock[] }[] = [];
  for (const block of blocks) {
    const start = sectionStart(block);
    if (start) {
      sections.push({ kind: start.kind, blocks: start.content });
      continue;
    }
    if (sections.length) sections[sections.length - 1].blocks.push(block);
    else leading.push(block);
  }

  const kinds = sections.map((s) => s.kind);
  if (!kinds.includes("objective") || !kinds.includes("practice") || !kinds.includes("submit")) return null;

  // The intro is the first callout before any section (🎓); other callouts there are notices.
  const lead = dropDividers(leading);
  const introAt = lead.findIndex((b) => b.type === "callout" && b.children?.length);
  const intro = introAt >= 0 ? lead[introAt].children! : [];
  const notices = lead.filter((_, i) => i !== introAt);
  const ledeAt = intro.findIndex((b) => b.type === "paragraph");
  const lede = ledeAt >= 0 ? intro[ledeAt].text ?? null : null;
  const introRest = intro.filter((_, i) => i !== ledeAt);

  const take = (kind: LessonSectionKind) =>
    dropDividers(sections.filter((s) => s.kind === kind).flatMap((s) => s.blocks));
  const practiceAt = kinds.indexOf("practice");
  const endAt = kinds.indexOf("end");
  // "Other" sections stay in Practice, before or after its steps as written.
  const otherBefore = dropDividers(
    sections.flatMap((s, i) => (s.kind === "other" && i < practiceAt ? s.blocks : [])),
  );
  const otherAfter = dropDividers(
    sections.flatMap((s, i) => (s.kind === "other" && i > practiceAt && (endAt < 0 || i < endAt) ? s.blocks : [])),
  );
  const tail = dropDividers(
    sections.flatMap((s, i) => (endAt >= 0 && i > endAt && s.kind !== "end" ? s.blocks : [])).concat(take("end")),
  );

  const split = splitSteps(take("practice"));
  const practice = {
    intro: [...otherBefore, ...split.intro],
    steps: split.steps,
    after: [...split.after, ...otherAfter],
  };
  const practiceIds = new Set<string>();
  collectIds([...practice.intro, ...practice.steps.flatMap((s) => s.blocks), ...practice.after], practiceIds);

  const learn = take("learn");
  const objective = take("objective");
  return {
    lede,
    introRest,
    notices,
    objective,
    minutes: lessonMinutes([...take("practice"), ...objective, ...learn]),
    learn,
    learnHref: firstWebLink(learn),
    why: take("why"),
    practice,
    submit: splitSubmit(take("submit")),
    tail,
    practiceIds,
  };
}

/**
 * "Claude Lesson 4: Build Something You Couldn't Before" → "Build Something You
 * Couldn't Before". The page shows the number in its own pill, so the title
 * does not repeat it. Titles without the prefix are unchanged.
 */
export function lessonDisplayTitle(title: string): string {
  const stripped = title.replace(/^(?:[\p{L}]+\s+)?lesson\s+\d+\s*[:.—–-]\s*/iu, "").trim();
  return stripped || title;
}
