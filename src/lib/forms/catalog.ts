import type { FormDocument, FormField, FormVariant } from "./document";

/**
 * WHAT A TEMPLATE IS, AND WHERE IT SITS IN THE LIBRARY.
 *
 * A leaf module on purpose. `library.ts` holds the forms an employee is the
 * subject of; `hiring-library.ts` holds the forms a CANDIDATE is the subject
 * of, and it is a separate file because the two are answerable to different
 * source documents and grow at different times. Both need the same seed shape
 * and the same `field` helper, so those live here rather than in one of them —
 * a shared helper imported from a sibling that imports you back is a module
 * cycle, and a cycle here would fail at the first `field(...)` call.
 */

export const BRAND = "SUN TAN CITY";

/**
 * One field, spelled short.
 *
 * `input` defaults to a single line because most of them are; a responsibility
 * has no default, because "who fills this" is the one thing about a field that
 * must never be inherited from a guess.
 */
export const field = (
  key: string,
  label: string,
  responsibility: FormField["responsibility"],
  input: FormField["input"] = "text",
  extra: Partial<FormField> = {},
): FormField => ({ key, label, input, responsibility, ...extra });

/* ---------------------------------------------------------- categories --- */

/**
 * THE CATEGORIES THE FORMS PAGE GROUPS BY.
 *
 * Ordered — this array is the display order, so a category moves by moving a
 * line here rather than by a number somebody has to keep unique.
 *
 * WHY THIS IS CODE AND NOT A LOOKUP TABLE. A category is a fact about the
 * library the app ships, the same way the templates themselves are: adding one
 * means adding forms to it, which is a code change either way. The `category`
 * COLUMN on `form_templates` exists so the database can answer "which category"
 * without the app, and it is plain text checked against this list — so a new
 * category needs no migration, only a new entry here.
 *
 * `hr_performance` is where the nine forms that already existed live. They were
 * never grouped before; naming the group they were already in is not moving
 * them, and nothing about Coaching, the corrective forms or the EPPs changes
 * because this constant now exists.
 */
export const FORM_CATEGORIES = [
  {
    key: "hr_performance",
    label: "HR & Performance Forms",
    blurb:
      "Coaching, corrective action and performance plans for people already on the team.",
  },
  {
    key: "hiring",
    label: "Hiring & Interview Forms",
    blurb:
      "Prescreening and interview forms, used while a candidate is still a candidate.",
  },
] as const;

export type FormCategoryKey = (typeof FORM_CATEGORIES)[number]["key"];

/**
 * The category a template falls back to when the database has not been migrated
 * yet, or when a row predates the column.
 *
 * The nine original forms, so an un-migrated deployment shows exactly the page
 * it showed before — one group, everything in it — rather than an empty one.
 */
export const DEFAULT_FORM_CATEGORY: FormCategoryKey = "hr_performance";

export function isFormCategory(value: unknown): value is FormCategoryKey {
  return FORM_CATEGORIES.some((category) => category.key === value);
}

export function formCategoryLabel(key: string): string {
  return FORM_CATEGORIES.find((category) => category.key === key)?.label ?? key;
}

/**
 * Templates split into the sections a screen renders, in category order.
 *
 * Driven by `FORM_CATEGORIES` rather than by the templates themselves, so the
 * sections always appear in the order this file declares and a category nobody
 * has put a form in yet does not print an empty heading.
 *
 * A template whose category THIS BUILD DOES NOT KNOW — a row written by a newer
 * deployment and read by an older one — falls into the last section rather than
 * off the page. A form an administrator cannot see is a form they cannot fix.
 */
export function groupTemplatesByCategory<T extends { category: string }>(
  templates: readonly T[],
): { key: string; label: string; blurb: string; templates: T[] }[] {
  const known = new Set<string>(FORM_CATEGORIES.map((category) => category.key));
  return FORM_CATEGORIES.map((category, index) => ({
    key: category.key as string,
    label: category.label as string,
    blurb: category.blurb as string,
    templates: templates.filter(
      (template) =>
        template.category === category.key ||
        (index === FORM_CATEGORIES.length - 1 && !known.has(template.category)),
    ),
  })).filter((category) => category.templates.length > 0);
}

/* ---------------------------------------------------------------- seed --- */

export type FormLayoutFamily =
  | "coaching"
  | "corrective"
  | "epp"
  | "dmit_epp"
  | "interview";

/**
 * WHERE A TEMPLATE'S SCHEMA WAS READ FROM, WHEN IT WAS NOT A PAPER FORM.
 *
 * Every other template in the library is a reading of a document the business
 * issues on paper: the seeder records a bundled default asset and the version's
 * notes name the source form. That is the default and it needs no annotation.
 *
 * One template is not. The Follow-Up Coaching Form is defined by a SECTION OF AN
 * APPROVED KNOWLEDGE-BASE FRAMEWORK — it names the form and specifies its fields
 * and its option lists — and no paper form for it was ever handed over. That is a
 * real difference and it has to be visible in the database rather than only in a
 * comment, because the question somebody asks months later is "which official
 * document is this form?" and for this one the honest answer is "none — it comes
 * from the framework".
 *
 * So a seed may declare its provenance, and the seeder writes it onto the
 * template's asset row in place of the plain `source: "bundled"` marker. Absent
 * means what it has always meant: this template reads a paper source form.
 */
export interface TemplateProvenance {
  /** Framework-defined. There is deliberately no `paper` case — that is the default. */
  kind: "framework";
  /** The knowledge-base document the schema was read out of. */
  document: string;
  /** The exact place in it, e.g. a section number and heading. */
  locator: string;
  /** Said in full, for whoever reads the row without this file to hand. */
  note: string;
}

export interface TemplateSeed {
  key: string;
  name: string;
  shortName: string;
  description: string;
  category: FormCategoryKey;
  layoutFamily: FormLayoutFamily;
  requiredPermission: string;
  displayOrder: number;
  document: FormDocument;
  variants: FormVariant[];
  /** Set only when the schema came from something other than a paper form. */
  provenance?: TemplateProvenance;
  /**
   * WHICH READING OF THE SOURCE DOCUMENT THIS IS.
   *
   * Bumped when the business hands over a NEW version of the paper form, never
   * for a wording tidy-up. The seeder publishes a template's revision once and
   * once only: a database already carrying revision 2 is left alone, and so is
   * one where an administrator has published a version of their own. See
   * `ensureTemplateLibrary`, which is the only thing that reads this.
   */
  revision: number;
  /** Says, in the version's own notes, which source it was published from. */
  revisionNote: string;
  /** The bundled document this template falls back to when nothing is uploaded. */
  bundledPdfName: string;
}
