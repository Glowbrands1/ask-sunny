import type { FormBlock, FormDocument, FormField, FieldResponsibility } from "../document";
import type { OutlineNode, SourceOutline } from "./outline";

/**
 * ============================================================================
 * THE OUTLINE, AS A NATIVE FORM
 * ============================================================================
 *
 * Every node maps to one of the engine's TWELVE EXISTING BLOCK KINDS. Nothing
 * new was added to the document model for this feature, and that was a finding
 * rather than a constraint accepted grudgingly: the block list was derived from
 * nine real business forms, so a tenth business form has little it can be made
 * of that is not already there.
 *
 * WHAT IS NOT REPRESENTABLE IS REPORTED, NOT APPROXIMATED. A source structure
 * with nowhere to go — a line of mixed labelled and unlabelled blanks, a blank
 * under no heading at all — becomes a WARNING on the proposal and is left out
 * of the document. A reviewer then sees "this line was not understood" next to
 * the form, which is a question they can answer. A guess would look identical
 * to a fact.
 *
 * RESPONSIBILITIES ARE NOT GUESSED FROM LABELS. Everything this file produces
 * is `manager` — a person fills it — except the handful of header lines the
 * ENGINE itself fills from the record. Deciding that a field called "Details"
 * should be drafted by Ask Sunny is a business decision about one form, and it
 * is made in the editor by the person reviewing the proposal. `align.ts` then
 * carries the decisions already made on the CURRENT version forward, so
 * re-issuing a form does not silently un-decide them.
 */

/* ------------------------------------------------------------------ keys --- */

/** A stable key from a label: lower case, words joined by underscores. */
export function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug || "field";
}

/**
 * THE FOUR LINES THE ENGINE ITSELF FILLS.
 *
 * `createInstance` seeds `employee_name`, `form_date`, `job_title` and
 * `location` from the record. A freshly extracted form that called them
 * `name` and `date` would render four blank rules where a name belongs — the
 * exact defect `instances.ts` documents having already fixed once.
 *
 * So this is a NAMING map, not an inference about meaning: a line labelled
 * "Name" on a Sun Tan City form is the person the form is about, and these are
 * the engine's words for that. Anything not on this short list gets a derived
 * key and belongs to whoever the reviewer says.
 */
const CANONICAL: { match: RegExp; key: string }[] = [
  { match: /^(employee\s+)?name$/i, key: "employee_name" },
  { match: /^applicant\s+name$/i, key: "employee_name" },
  { match: /^date$/i, key: "form_date" },
  { match: /^job\s*title$/i, key: "job_title" },
  { match: /^position\s+applied\s+for$/i, key: "job_title" },
  { match: /^(location|salon\s*name)$/i, key: "location" },
];

function canonicalKey(label: string): string | null {
  return CANONICAL.find((entry) => entry.match.test(label.trim()))?.key ?? null;
}

/* ------------------------------------------------------------ generation --- */

export interface GeneratedDocument {
  document: FormDocument;
  /** What a reviewer needs told before they publish this. */
  warnings: string[];
}

class KeyMinter {
  private taken = new Set<string>();

  /** A unique key, preferring the canonical name for a header line. */
  mint(label: string, fallback: string): string {
    const base = canonicalKey(label) ?? slugify(label || fallback);
    if (!this.taken.has(base)) {
      this.taken.add(base);
      return base;
    }
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base}_${suffix}`;
      if (!this.taken.has(candidate)) {
        this.taken.add(candidate);
        return candidate;
      }
    }
  }
}

function field(
  key: string,
  label: string,
  input: FormField["input"],
  responsibility: FieldResponsibility,
): FormField {
  return { key, label, input, responsibility };
}

/** Which responsibility a newly extracted line starts on. See the note above. */
function startingResponsibility(label: string): FieldResponsibility {
  return canonicalKey(label) ? "system" : "manager";
}

export function outlineToDocument(outline: SourceOutline): GeneratedDocument {
  const blocks: FormBlock[] = [];
  const warnings: string[] = [];
  const keys = new KeyMinter();

  for (const unresolved of outline.unresolved) {
    warnings.push(`Line ${unresolved.index + 1} was not understood (${unresolved.reason}): "${unresolved.text}"`);
  }

  for (const node of outline.nodes) {
    switch (node.kind) {
      case "title":
        blocks.push({
          kind: "letterhead",
          brand: node.brand ?? "",
          title: node.text,
        });
        break;

      case "heading":
        blocks.push({ kind: "section", label: node.text });
        break;

      case "fields": {
        const made = node.fields.map((entry) =>
          field(
            keys.mint(entry.label, "field"),
            entry.label,
            entry.input === "long_text" ? "long_text" : entry.input,
            startingResponsibility(entry.label),
          ),
        );
        // Two to a row is how these forms print a header, and it is what the
        // surface lays a field row out as. A longer run becomes further rows
        // rather than one row nothing can fit.
        for (let index = 0; index < made.length; index += 2) {
          const pair = made.slice(index, index + 2);
          if (pair.length === 1) blocks.push({ kind: "field", field: pair[0]! });
          else blocks.push({ kind: "field_row", fields: pair });
        }
        break;
      }

      case "options": {
        const heading = lastSectionLabel(blocks);
        const groupKey = keys.mint(heading ?? "", "options");
        blocks.push({
          kind: "checkbox_group",
          key: groupKey,
          options: node.options.map((label) => ({ key: slugify(label), label })),
          responsibility: "manager",
          columns: node.columns >= 3 ? 3 : 2,
        });
        if (node.writeIn) {
          // The option that carried its own blank keeps both halves: the tick,
          // and somewhere to write what it was.
          blocks.push({
            kind: "field",
            field: field(
              keys.mint(node.writeIn, "other"),
              node.writeIn,
              "text",
              "manager",
            ),
          });
        }
        break;
      }

      case "writing_area": {
        const label = node.label ?? lastSectionLabel(blocks);
        if (!label) {
          warnings.push(
            "A blank writing area appeared before any heading, so there was nothing to call it. It was left out.",
          );
          break;
        }
        blocks.push({
          kind: "field",
          field: field(keys.mint(label, "notes"), label, "long_text", "manager"),
        });
        break;
      }

      case "signature":
        blocks.push({
          kind: "signature_row",
          label: node.label,
          dateLabel: node.dateLabel,
        });
        break;

      case "acknowledgement":
        blocks.push({ kind: "acknowledgement", text: node.text });
        break;

      case "instruction":
        blocks.push({ kind: "note", text: node.text });
        break;

      case "paragraph":
        blocks.push({ kind: "paragraph", text: node.text });
        break;
    }
  }

  if (!blocks.some((block) => block.kind === "letterhead")) {
    warnings.push(
      "No title was found in the document, so the form kept the letterhead it already had.",
    );
  }

  return { document: { paper: "letter", blocks }, warnings };
}

function lastSectionLabel(blocks: readonly FormBlock[]): string | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]!;
    if (block.kind === "section") return block.label;
  }
  return null;
}

/** Every node kind, for the AI pass's schema and for the tests. */
export const OUTLINE_KINDS: OutlineNode["kind"][] = [
  "title",
  "heading",
  "fields",
  "options",
  "writing_area",
  "signature",
  "acknowledgement",
  "instruction",
  "paragraph",
];
