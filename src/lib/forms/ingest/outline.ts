/**
 * ============================================================================
 * THE INTERMEDIATE REPRESENTATION, AND THE RULES THAT BUILD IT
 * ============================================================================
 *
 * A business form arrives as a PDF or as a Word file. Those two are read by
 * different libraries and produce different signals, so they both stop HERE, at
 * one line model, and everything downstream reads only this. That is what keeps
 * "the PDF path" and "the Word path" from becoming two extractors that drift.
 *
 * PURE, AND DELIBERATELY SO. Nothing in this file opens a file, calls a model
 * or touches a database — it turns lines into an outline. Every rule below can
 * therefore be tested against a literal array of lines, which is the only way
 * to have a rule set anybody can reason about.
 *
 * ============================================================================
 * THE ONE RULE THAT MATTERS MOST: NO TEXT IS EVER AUTHORED HERE
 * ============================================================================
 *
 * Every string that reaches the outline was read out of the document. This code
 * classifies and groups; it never writes a label, a question or an option. A
 * form is a record about a person's employment, and a field this pipeline
 * invented would be a question nobody at the company ever asked. The same rule
 * binds the optional AI pass in `refine.ts`, which may return a KIND for a line
 * and can never return the line.
 *
 * WHAT IS NOT UNDERSTOOD SAYS SO. A line no rule claims becomes `unresolved`
 * and is carried through to the review screen as a warning. Guessing would
 * produce a form that looks finished and is wrong, which is the failure mode
 * this whole feature has to avoid — a manager cannot tell a hallucinated
 * question from a real one.
 */

/* ------------------------------------------------------------- the line --- */

export interface SourceLine {
  /** Text with tabs and runs of whitespace collapsed. Never empty. */
  text: string;
  /** The whole line was bold, or carried a heading style. */
  emphasised: boolean;
  /** An explicit heading level from the source, where it had one. */
  headingLevel: number | null;
  /**
   * Option labels found on this line, in source order.
   *
   * Populated by the readers: a `.docx` says so with a checkbox control, a PDF
   * with a ☐ glyph. Downstream never re-detects them, so the two formats agree
   * about what a checkbox is.
   */
  checkboxes: string[];
  /** True for a line read from the page header rather than the body. */
  chrome: boolean;
}

export function line(text: string, extra: Partial<SourceLine> = {}): SourceLine {
  return {
    text,
    emphasised: false,
    headingLevel: null,
    checkboxes: [],
    chrome: false,
    ...extra,
  };
}

/* ---------------------------------------------------------- placeholders --- */

/**
 * What an empty answer looks like on a business form.
 *
 * Word's content-control prompts, and the ruled line somebody types over. These
 * are the strongest signal in the whole document: a placeholder means "a person
 * writes here", which is exactly what a field is.
 */
const PLACEHOLDER =
  /(Click or tap here to enter text\.?|Click or tap to enter a date\.?|Enter text here\.?|_{3,}|\.{6,})/gi;

const DATE_PLACEHOLDER = /date/i;

/** Text a person would not have typed, so it never becomes a label. */
export function stripPlaceholders(text: string): string {
  return text.replace(PLACEHOLDER, " ").replace(/\s+/g, " ").trim();
}

export function hasPlaceholder(text: string): boolean {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(text);
}

/* ------------------------------------------------------------- the nodes --- */

export type OutlineInput = "text" | "long_text" | "date";

export interface OutlineField {
  label: string;
  input: OutlineInput;
}

export type OutlineNode =
  /** The document's own name, and the brand above it. */
  | { kind: "title"; text: string; brand: string | null }
  /** A section bar. */
  | { kind: "heading"; text: string }
  /** One or more labelled answers on a line: "Name: ___  Date: ___". */
  | { kind: "fields"; fields: OutlineField[] }
  /**
   * A run of ticks. `writeIn` is an option that carried its own blank.
   *
   * `columns` is the widest ROW the source printed this group over — three for
   * a form that lays its topics out three across — so the native form keeps the
   * shape of the page rather than defaulting everything to two.
   */
  | { kind: "options"; options: string[]; writeIn: string | null; columns: number }
  /** An unlabelled blank under a heading — the place an answer is written. */
  | { kind: "writing_area"; label: string | null }
  /** A ruled signature line and its date. */
  | { kind: "signature"; label: string; dateLabel: string }
  /** The sentence a person signs under. */
  | { kind: "acknowledgement"; text: string }
  /** Guidance addressed to whoever fills the form in. */
  | { kind: "instruction"; text: string }
  /** Prose that is part of the form: a question, a scenario, a value. */
  | { kind: "paragraph"; text: string };

export interface UnresolvedLine {
  /** Index into the line array this outline was built from. */
  index: number;
  text: string;
  reason: string;
}

export interface SourceOutline {
  nodes: OutlineNode[];
  /** Lines no rule claimed. Carried to the review screen, never guessed at. */
  unresolved: UnresolvedLine[];
  /** How many options the widest checkbox row held — the printed column count. */
  optionColumns: number;
}

/* --------------------------------------------------------- line analysis --- */

const SIGNATURE = /\bsignature\b/i;
const ACKNOWLEDGEMENT = /\backnowledge?ment\b/i;
const SENTENCE_END = /[.?!]["')\]]?$/;

/**
 * Guidance rather than content.
 *
 * Kept SHORT and literal on purpose. A looser rule — "any imperative sentence"
 * — swallowed real interview questions, which are imperative too ("Describe a
 * time you..."). These four openings are what the supplied forms actually use
 * to address the person holding the clipboard.
 */
const INSTRUCTION_OPENERS = [
  /^please note\b/i,
  /^note:\s/i,
  /^if the response to these questions\b/i,
  /^if you do not receive\b/i,
  /^attach this completed form\b/i,
  /^explain each section\b/i,
  /^observe (the )?candidate\b/i,
  /^if interview goes well\b/i,
];

function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_OPENERS.some((pattern) => pattern.test(text));
}

/**
 * A heading, as a form prints one.
 *
 * Short, not a sentence, nothing to fill in on it. Emphasis or an explicit
 * heading level makes it certain; without either, a short non-sentence line
 * that introduces something still reads as a heading on the page, which is why
 * `emphasised` is a strong signal rather than a required one — a flat PDF has
 * no bold to report.
 */
function looksLikeHeading(candidate: SourceLine, next: SourceLine | undefined): boolean {
  const text = candidate.text;
  if (candidate.checkboxes.length > 0 || hasPlaceholder(text)) return false;
  if (candidate.headingLevel !== null) return true;
  if (text.length > 64) return false;
  if (SENTENCE_END.test(text)) return false;
  if (SIGNATURE.test(text)) return false;
  if (candidate.emphasised) return true;
  // A trailing line with nothing under it is not introducing anything.
  return next !== undefined && text.split(" ").length <= 8;
}

/**
 * Splits "Name: ___   Date: ___" into its labelled blanks.
 *
 * Driven from the PLACEHOLDERS OUT rather than from the colons in: a colon
 * appears inside question text all the time, and a blank never appears without
 * something to fill in. Each blank takes the text immediately before it as its
 * label, which is how the page reads.
 */
export function readFieldLine(text: string): OutlineField[] {
  PLACEHOLDER.lastIndex = 0;
  const parts = text.split(PLACEHOLDER);
  if (parts.length < 3) return [];

  const fields: OutlineField[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    const placeholder = parts[index] ?? "";
    const before = (parts[index - 1] ?? "").trim();
    const label = before.replace(/[:\-–]\s*$/, "").trim();
    const isDate =
      DATE_PLACEHOLDER.test(placeholder) || /(^|\s)date$/i.test(label);
    fields.push({ label, input: isDate ? "date" : "text" });
  }
  return fields;
}

/** "Employee Signature   Date" -> the caption pair a signature row prints. */
function readSignatureLine(text: string): { label: string; dateLabel: string } {
  const trimmed = stripPlaceholders(text);
  const withoutDate = trimmed.replace(/\s*\bdate\b\s*$/i, "").trim();
  const hadDate = withoutDate !== trimmed;
  return {
    label: withoutDate || "Signature",
    // The caption the source printed, or the one every one of these forms uses.
    dateLabel: hadDate ? trimmed.slice(withoutDate.length).trim() : "Date",
  };
}

/* ------------------------------------------------------------- building --- */

export interface OutlineOptions {
  /**
   * The brand the library already prints.
   *
   * Used for ONE decision: whether the line under the title is the company name
   * or the first section heading. "Coaching Form / Sun Tan City / Employee
   * Information" and "Coaching Form / Employee Information / ..." are the same
   * shape, and only knowing the brand tells them apart. Where it is unknown the
   * line is left as a heading, which a reviewer can see and correct — the safe
   * direction, since a heading wrongly eaten as a brand would vanish.
   */
  brand?: string | null;
  /**
   * A kind for a line the rules cannot place, from `refine.ts`.
   *
   * Consulted ONLY where a line would otherwise be unresolved, so a hint can
   * never override something the rules could prove from a glyph or a
   * placeholder.
   */
  hints?: Record<number, "heading" | "paragraph" | "instruction" | "acknowledgement" | "drop">;
}

/**
 * Turns a document's lines into an outline.
 *
 * Order is preserved exactly. A form is a sequence — the question, then the
 * space for the answer — and a pass that reordered anything would produce a
 * document that no longer reads like the one on the wall.
 */
export function buildOutline(
  lines: readonly SourceLine[],
  options: OutlineOptions = {},
): SourceOutline {
  const nodes: OutlineNode[] = [];
  const unresolved: UnresolvedLine[] = [];
  let optionColumns = 0;
  let titleTaken = false;
  /** Set when the last heading was the acknowledgement bar. */
  let underAcknowledgement = false;
  /** The heading a bare blank belongs to, so it can be labelled. */
  let lastHeading: string | null = null;

  const body = lines.filter((entry) => !entry.chrome);
  const chrome = lines.filter((entry) => entry.chrome);
  const hints = options.hints ?? {};

  /**
   * Places a line the rules could not, from a hint. Returns whether it did.
   *
   * Only the four TEXT-ONLY kinds can arrive here — see `refine.ts` for why the
   * structural ones stay with the rules — so the line's own text is all that is
   * ever used. Nothing a hint carries reaches the form.
   */
  function applyHint(index: number, text: string): boolean {
    const hint = hints[index];
    if (!hint) return false;
    if (hint === "drop") return true;
    if (hint === "heading") {
      nodes.push({ kind: "heading", text });
      lastHeading = text;
      underAcknowledgement = ACKNOWLEDGEMENT.test(text);
      return true;
    }
    nodes.push({ kind: hint, text });
    return true;
  }

  /*
   * THE TITLE COMES FROM THE PAGE HEADER WHERE THERE IS ONE.
   *
   * A .docx keeps its title and its brand in `word/header1.xml`, so the body
   * starts at "Employee Information" and a reader that only saw the body would
   * produce a form with no name on it. A flat PDF has no such separation: its
   * first two lines ARE the title and the brand.
   */
  if (chrome.length > 0) {
    nodes.push({
      kind: "title",
      text: chrome[0]!.text,
      brand: options.brand ?? chrome[1]?.text ?? null,
    });
    titleTaken = true;
  }

  for (let index = 0; index < body.length; index += 1) {
    const current = body[index]!;
    const next = body[index + 1];
    const text = current.text;

    /* --------------------------------------------------- title and brand --- */
    if (!titleTaken && current.checkboxes.length === 0 && !hasPlaceholder(text)) {
      // The first line is the document's name; a short line under it that is
      // not a heading for anything is the brand.
      const brandLine = next && next.text.length <= 40 && !SENTENCE_END.test(next.text)
        ? next
        : undefined;
      const brandIsBrand =
        brandLine !== undefined &&
        options.brand !== undefined &&
        options.brand !== null &&
        brandLine.text.toLowerCase() === options.brand.toLowerCase();
      nodes.push({
        kind: "title",
        text,
        brand: brandIsBrand ? brandLine!.text : (options.brand ?? null),
      });
      titleTaken = true;
      if (brandIsBrand) index += 1;
      continue;
    }

    /* ------------------------------------------------------------ ticks --- */
    if (current.checkboxes.length > 0) {
      const options_: string[] = [];
      let writeIn: string | null = null;
      for (const raw of current.checkboxes) {
        const label = stripPlaceholders(raw).replace(/[:\-–]\s*$/, "").trim();
        if (!label) continue;
        // "Other: ____" is a tick AND a blank. Both are kept: the option so it
        // can be ticked, the blank so what it was can be written down.
        if (hasPlaceholder(raw)) writeIn = label;
        options_.push(label);
      }
      if (options_.length === 0) {
        if (!applyHint(index, text)) {
          unresolved.push({ index, text, reason: "a checkbox row with no readable options" });
        }
        continue;
      }
      optionColumns = Math.max(optionColumns, options_.length);
      const previous = nodes[nodes.length - 1];
      // Consecutive tick rows are ONE group. They are one group on the page —
      // Topic of Coaching is eleven options over four rows, not four questions.
      if (previous && previous.kind === "options" && previous.writeIn === null) {
        previous.options.push(...options_);
        previous.writeIn = writeIn;
        previous.columns = Math.max(previous.columns, options_.length);
      } else {
        nodes.push({ kind: "options", options: options_, writeIn, columns: options_.length });
      }
      continue;
    }

    /* -------------------------------------------------------- signature --- */
    if (SIGNATURE.test(text)) {
      /*
       * THE BLANK ABOVE A SIGNATURE CAPTION BELONGS TO THE SIGNATURE.
       *
       * A form prints the rule first and names it underneath, so the line
       * before "Employee Signature   Date" is that signature's own blank. It is
       * dropped rather than kept, because a signature is never filled from the
       * app: `document.ts` gives signature rows no field key at all, precisely
       * so there is no path by which anything could be written into one. Left
       * in, it would become a text box where a handwritten signature goes.
       *
       * Dropped whatever it is labelled. It picked up the heading above it —
       * "Acknowledgement of Coaching" — which is where it sits on the page and
       * is not what it is.
       */
      const previous = nodes[nodes.length - 1];
      if (previous && previous.kind === "writing_area") nodes.pop();
      const { label, dateLabel } = readSignatureLine(text);
      nodes.push({ kind: "signature", label, dateLabel });
      continue;
    }

    /* ---------------------------------------------------------- blanks --- */
    if (hasPlaceholder(text)) {
      const remainder = stripPlaceholders(text);
      const fields = readFieldLine(text);
      const labelled = fields.filter((field) => field.label.length > 0);

      if (labelled.length > 0 && labelled.length === fields.length) {
        nodes.push({ kind: "fields", fields });
        continue;
      }
      if (remainder.length === 0) {
        // Nothing but blanks: the writing space under the heading above it.
        nodes.push({ kind: "writing_area", label: lastHeading });
        continue;
      }
      // Some blanks are labelled and some are not — report it rather than
      // guessing which label belongs to which blank.
      if (!applyHint(index, text)) {
        unresolved.push({
          index,
          text,
          reason: "a line mixing labelled and unlabelled blanks",
        });
      }
      continue;
    }

    /* --------------------------------------------------------- headings --- */
    if (looksLikeHeading(current, next)) {
      nodes.push({ kind: "heading", text });
      lastHeading = text;
      underAcknowledgement = ACKNOWLEDGEMENT.test(text);
      continue;
    }

    /* ------------------------------------------------------------ prose --- */
    if (underAcknowledgement && SENTENCE_END.test(text)) {
      nodes.push({ kind: "acknowledgement", text });
      underAcknowledgement = false;
      continue;
    }
    if (looksLikeInstruction(text)) {
      nodes.push({ kind: "instruction", text });
      continue;
    }
    nodes.push({ kind: "paragraph", text });
  }

  return { nodes, unresolved, optionColumns: optionColumns || 2 };
}
