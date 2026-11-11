import { extractEmployeeNames, samePerson } from "./proposal";

/**
 * ============================================================================
 * A PASTED TEMPLATE FILLS THE OPEN DRAFT'S FIELDS
 * ============================================================================
 *
 * PASTED_TEMPLATE_FIELDS_TO_OPEN_DRAFT_ENABLED (QA's Sunny round-25 live test of sf-s21, 11 Nov 2026). With <A>'s
 * Corrective Action draft open, the manager pasted <B>'s CA as a template ("Observation of Offense: … <B> completed
 * 237 tanning transactions … Action Plan: The Leadership Team will coach <B> …"). PASTED_OUTLINE_TO_OPEN_DRAFT keeps it
 * on the open draft, but the revision wrote nothing and the reply was "Nothing on the form has changed yet. I couldn't
 * place that …". With this flag on, when the revision writes nothing, each labelled section of the paste goes into the
 * open draft's field of that label, and the template's person is the draft's employee, never a person switch.
 *
 * Pure: the caller loads the fields, writes the values and says what was placed.
 */

export interface TemplateField {
  readonly key: string;
  readonly label: string;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function headingPattern(label: string): RegExp {
  return new RegExp(String.raw`(?:^|\n)[ \t]*${escaped(label.trim()).replace(/\s+/g, String.raw`\s+`)}[ \t]*:`, "i");
}

/** Each labelled section of the paste, by the open form's field key: the text after "<Label>:" up to the next label. */
export function templateSections(text: string, fields: readonly TemplateField[]): Record<string, string> {
  const found: { key: string; start: number; end: number }[] = [];
  for (const field of fields) {
    if (field.label.trim().length < 4) continue;
    const match = headingPattern(field.label).exec(text);
    if (match) found.push({ key: field.key, start: match.index, end: match.index + match[0].length });
  }
  found.sort((a, b) => a.start - b.start);
  const sections: Record<string, string> = {};
  found.forEach((heading, index) => {
    const next = found[index + 1]?.start ?? text.length;
    const body = text
      .slice(heading.end, next)
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n")
      .trim();
    if (body) sections[heading.key] = body;
  });
  return sections;
}

const MONTHS = /^(?:January|February|March|April|May|June|July|August|September|October|November|December)$/;

/**
 * The template's person: a standalone capitalised word used at least twice, at least once mid-sentence ("Tamsyn
 * completed …", "coach Tamsyn on …"), that is not a month and not part of a capitalised phrase ("Must See Behaviors",
 * "Average Club"), with its full name when the paste gives one. The general name readers are not used alone: on a
 * template they read "Average Club" and "Sun Tan City" as names.
 */
export function templatePerson(text: string, employeeName: string): string | null {
  const counts = new Map<string, { total: number; mid: number }>();
  // A two-word name the readers find ("Tamsyn Fairlow"): its first name, there, counts as a person's use of it.
  const fullNames = extractEmployeeNames(text).filter((name) => name.trim().split(/\s+/).length === 2 && !samePerson(name, employeeName));
  const firstOfFull = new Set(fullNames.map((name) => name.trim().split(/\s+/)[0]!));
  const pattern = /(^|[^A-Za-z'’])([A-Z][a-z]+)(?![A-Za-z'’])/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const word = match[2]!;
    const start = match.index + match[1]!.length;
    const before = text.slice(0, start);
    const after = text.slice(start + word.length);
    const inPhrase = /[A-Z][a-z]+\s+$/.test(before) || /^\s+[A-Z][a-z]/.test(after);
    if (inPhrase && !(firstOfFull.has(word) && /^\s+[A-Z][a-z]/.test(after))) continue;
    if (MONTHS.test(word)) continue;
    const sentenceStart = /(^|[.!?:]\s+|\n\s*)$/.test(before);
    const seen = counts.get(word) ?? { total: 0, mid: 0 };
    counts.set(word, { total: seen.total + 1, mid: seen.mid + (sentenceStart && !inPhrase ? 0 : 1) });
  }
  const own = new Set(employeeName.toLowerCase().split(/\s+/));
  const best = [...counts.entries()]
    .filter(([word, seen]) => seen.total >= 2 && seen.mid >= 1 && !own.has(word.toLowerCase()))
    .sort((a, b) => b[1].total - a[1].total)[0];
  if (!best) return null;
  // The readers' full name for that person, when the paste gives one ("Tamsyn Fairlow"); never the draft's employee.
  const full = fullNames.find((name) => name.trim().split(/\s+/)[0] === best[0]);
  return full ?? best[0];
}

/** The section with the template's person written as the draft's employee: a full name as the full name, else the first name. */
export function asTheDraftsEmployee(text: string, templateName: string, employeeName: string): string {
  const first = employeeName.trim().split(/\s+/)[0] ?? employeeName;
  const parts = templateName.trim().split(/\s+/);
  let out = text;
  if (parts.length > 1) out = out.replace(new RegExp(String.raw`\b${escaped(templateName.trim()).replace(/\s+/g, String.raw`\s+`)}\b`, "g"), employeeName.trim());
  return out.replace(new RegExp(String.raw`\b${escaped(parts[0]!)}\b`, "g"), first);
}

/** The values a pasted template places on the open draft, by field key, with its person as the draft's employee. */
export function pastedTemplateValues(input: {
  readonly text: string;
  readonly fields: readonly TemplateField[];
  readonly employeeName: string;
}): Record<string, string> {
  const sections = templateSections(input.text, input.fields);
  const person = templatePerson(input.text, input.employeeName);
  return Object.fromEntries(
    Object.entries(sections).map(([key, body]) => [key, person ? asTheDraftsEmployee(body, person, input.employeeName) : body]),
  );
}

/** Two or more "<Label>:" lines: the shape of a pasted labelled template, read before the open form's fields are loaded. */
const LABEL_LINE = /(?:^|\n)[ \t]*[A-Z][A-Za-z /&'’-]{3,40}[ \t]*:/g;
export function looksLikePastedTemplate(text: string): boolean {
  return (text.match(LABEL_LINE) ?? []).length >= 2;
}

/** The revision's "nothing changed" reply ("I haven't changed the **<form>** … — everything on it is as it was."). */
const NOTHING_CHANGED = /^\s*(?:I didn't change anything on the form\.|I haven'?t changed the \*\*[^*]+\*\*[^.\n]*?—\s*everything on it is as it was\.)/;
export function revisionChangedNothing(content: string): boolean {
  return NOTHING_CHANGED.test(content);
}
