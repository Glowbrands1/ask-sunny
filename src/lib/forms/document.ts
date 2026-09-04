/**
 * THE FORM DOCUMENT MODEL.
 *
 * A template version is a document: an ordered list of blocks that renders three
 * ways from one definition — the editor an administrator sees, the fill screen a
 * manager works in, and the printed PDF. One model rather than three is what
 * stops the printed form drifting from the screen it was filled on.
 *
 * The shape comes from the nine reference forms, and every block type in here
 * earns its place from something one of them does:
 *
 *   `section`        the black bars — Employee Information, Type of Warning
 *   `field_row`      the two-up rows: Employee Name / Date, Job Title / Location
 *   `checkbox_group` Type of Coaching, Type of Offense, Topic Of Coaching
 *   `numbered_list`  "Overall top three strengths: 1. 2. 3."
 *   `signature_row`  always-blank signature and date pairs
 *   `page_break`     the DMIT EPP's explicit page breaks
 *   `reference`      the DMIT EPP's position-description block, role-scoped
 *   `acknowledgement` the confirmation paragraph above each signature block
 *
 * TWO THINGS ARE LOAD-BEARING.
 *
 * 1. EVERY FIELD CARRIES A RESPONSIBILITY, and that is template data, not a
 *    hint. The reference forms mark fields "AI FILLS: ..." or "FILLED BY HAND";
 *    those become `responsibility` here and the server enforces it against
 *    whatever a model returns. A field's responsibility is per template: the
 *    DMIT EPP's self-review is filled by hand, the SDIT EPP's is drafted, and
 *    neither is a global rule about "self review" fields.
 *
 * 2. `{{role}}` AND `{{roleAbbr}}` ARE RESOLVED FROM THE CHOSEN VARIANT, never
 *    guessed. The DMIT EPP is one document read two ways — as a TSD review and
 *    as a DMIT review — and the same is true of the four EPPs, which differ by
 *    who reviews whom. Interpolation happens at render time so the stored
 *    document stays one thing.
 */

export const FIELD_RESPONSIBILITIES = [
  "system",
  "ai",
  "manager",
  "employee",
  "manual",
  "signature",
] as const;

export type FieldResponsibility = (typeof FIELD_RESPONSIBILITIES)[number];

/** What each responsibility means where a human has to read it. */
export const RESPONSIBILITY_LABEL: Record<FieldResponsibility, string> = {
  system: "Filled by Ask Sunny from record",
  ai: "Ask Sunny drafts",
  manager: "Manager completes",
  employee: "Employee completes",
  manual: "Filled by hand",
  signature: "Always blank — signed by hand",
};

/**
 * The short chip the editor shows on the block itself.
 *
 * `system` and `ai` both read "AI FILLS", which is deliberate and matches the
 * reference forms: from the reader's side both are Ask Sunny filling the field,
 * and the distinction that matters to THEM is only "does a person have to write
 * this". The difference the engine cares about — filled from the record versus
 * drafted by the model — is real and is what the gear says, but it is not a
 * distinction an administrator needs on the page. Labelling one "AUTO" only
 * raised the question of what AUTO meant.
 */
export const RESPONSIBILITY_CHIP: Record<FieldResponsibility, string> = {
  system: "AI FILLS",
  ai: "AI FILLS",
  manager: "MANAGER",
  employee: "EMPLOYEE",
  manual: "FILLED BY HAND",
  signature: "SIGNED BY HAND",
};

/**
 * Responsibilities the assistant is allowed to write into.
 *
 * Exactly one. `system` is filled from the record by the server, not by a
 * model, and everything else belongs to a person. This constant is the single
 * place that decision lives — `enforceResponsibilities` reads it, the prompt
 * builder reads it, and the tests assert on it.
 */
export const AI_WRITABLE: readonly FieldResponsibility[] = ["ai"];

export type FieldInput = "text" | "long_text" | "date";

export interface FormField {
  key: string;
  label: string;
  input: FieldInput;
  responsibility: FieldResponsibility;
  /** Guidance for the manager, and context for the assistant's prompt. */
  help?: string;
  /**
   * Marks a field whose content must be grounded in approved policy — the
   * "Policy Violated" and "Direct policy from official manual" lines. The
   * assistant may only fill these from a knowledge-base match, and leaves them
   * for the manager when it cannot find one. See `lib/forms/policy-grounding`.
   */
  policyGrounded?: boolean;
}

export interface CheckboxOption {
  key: string;
  label: string;
}

export type FormBlock =
  | { kind: "letterhead"; brand: string; title: string; variantKey?: string }
  | { kind: "section"; label: string; variantKey?: string }
  | { kind: "paragraph"; text: string; variantKey?: string }
  | { kind: "note"; text: string; variantKey?: string }
  | { kind: "field"; field: FormField; variantKey?: string }
  | { kind: "field_row"; fields: FormField[]; variantKey?: string }
  | {
      kind: "checkbox_group";
      key: string;
      label?: string;
      options: CheckboxOption[];
      responsibility: FieldResponsibility;
      columns: 2 | 3;
      variantKey?: string;
    }
  | {
      kind: "numbered_list";
      key: string;
      label: string;
      count: number;
      responsibility: FieldResponsibility;
      help?: string;
      variantKey?: string;
    }
  | { kind: "signature_row"; label: string; dateLabel: string; variantKey?: string }
  | { kind: "page_break"; variantKey?: string }
  | { kind: "reference"; label: string; body: string[]; variantKey?: string }
  | { kind: "acknowledgement"; text: string; variantKey?: string };

export interface FormVariant {
  key: string;
  label: string;
  /** Substituted for `{{role}}` — "District Manager". */
  role: string;
  /** Substituted for `{{roleAbbr}}` — "DM". */
  roleAbbr: string;
  /** The position being reviewed, where the document names it: "TSD". */
  reviewedPosition?: string;
}

export interface FormDocument {
  /** Paper the printed form is laid out for. Letter everywhere so far. */
  paper: "letter";
  blocks: FormBlock[];
}

/* --------------------------------------------------------------- parsing --- */

export class FormDocumentError extends Error {}

const BLOCK_KINDS = new Set([
  "letterhead",
  "section",
  "paragraph",
  "note",
  "field",
  "field_row",
  "checkbox_group",
  "numbered_list",
  "signature_row",
  "page_break",
  "reference",
  "acknowledgement",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readField(raw: unknown, where: string): FormField {
  if (!isRecord(raw)) throw new FormDocumentError(`${where}: a field must be an object`);
  const key = raw.key;
  const label = raw.label;
  const input = raw.input;
  const responsibility = raw.responsibility;

  if (typeof key !== "string" || key.length === 0) {
    throw new FormDocumentError(`${where}: a field needs a key`);
  }
  if (typeof label !== "string") throw new FormDocumentError(`${where}: ${key} needs a label`);
  if (input !== "text" && input !== "long_text" && input !== "date") {
    throw new FormDocumentError(`${where}: ${key} has an unknown input "${String(input)}"`);
  }
  if (!FIELD_RESPONSIBILITIES.includes(responsibility as FieldResponsibility)) {
    throw new FormDocumentError(
      `${where}: ${key} has an unknown responsibility "${String(responsibility)}"`,
    );
  }

  return {
    key,
    label,
    input,
    responsibility: responsibility as FieldResponsibility,
    ...(typeof raw.help === "string" ? { help: raw.help } : {}),
    ...(raw.policyGrounded === true ? { policyGrounded: true } : {}),
  };
}

/**
 * Reads a stored document back, refusing anything it cannot fully understand.
 *
 * A form is a legal-ish record: a block this code does not recognise would be
 * silently dropped from the printed page, which is worse than failing. So an
 * unknown block kind, a missing responsibility or a duplicate field key is an
 * error, not a warning.
 */
export function parseFormDocument(raw: unknown): FormDocument {
  if (!isRecord(raw)) throw new FormDocumentError("A document must be an object");
  const blocks = raw.blocks;
  if (!Array.isArray(blocks)) throw new FormDocumentError("A document needs a block list");

  const seen = new Set<string>();
  const claimKey = (key: string, where: string) => {
    if (seen.has(key)) throw new FormDocumentError(`${where}: duplicate field key "${key}"`);
    seen.add(key);
  };

  const parsed: FormBlock[] = blocks.map((block, index) => {
    const where = `block ${index}`;
    if (!isRecord(block)) throw new FormDocumentError(`${where}: must be an object`);
    const kind = block.kind;
    if (typeof kind !== "string" || !BLOCK_KINDS.has(kind)) {
      throw new FormDocumentError(`${where}: unknown block kind "${String(kind)}"`);
    }
    const variantKey = typeof block.variantKey === "string" ? block.variantKey : undefined;

    switch (kind) {
      case "letterhead":
        return {
          kind,
          brand: String(block.brand ?? ""),
          title: String(block.title ?? ""),
          variantKey,
        };
      case "section":
        return { kind, label: String(block.label ?? ""), variantKey };
      case "paragraph":
      case "note":
      case "acknowledgement":
        return { kind, text: String(block.text ?? ""), variantKey } as FormBlock;
      case "field": {
        const field = readField(block.field, where);
        claimKey(field.key, where);
        return { kind, field, variantKey };
      }
      case "field_row": {
        const fields = Array.isArray(block.fields) ? block.fields : [];
        const parsedFields = fields.map((entry) => readField(entry, where));
        parsedFields.forEach((field) => claimKey(field.key, where));
        return { kind, fields: parsedFields, variantKey };
      }
      case "checkbox_group": {
        const key = String(block.key ?? "");
        if (!key) throw new FormDocumentError(`${where}: a checkbox group needs a key`);
        claimKey(key, where);
        const options = Array.isArray(block.options) ? block.options : [];
        if (options.length === 0) {
          throw new FormDocumentError(`${where}: ${key} has no options`);
        }
        const responsibility = block.responsibility;
        if (!FIELD_RESPONSIBILITIES.includes(responsibility as FieldResponsibility)) {
          throw new FormDocumentError(`${where}: ${key} has an unknown responsibility`);
        }
        return {
          kind,
          key,
          ...(typeof block.label === "string" ? { label: block.label } : {}),
          options: options.map((option) => {
            if (!isRecord(option)) throw new FormDocumentError(`${where}: bad option in ${key}`);
            return { key: String(option.key ?? ""), label: String(option.label ?? "") };
          }),
          responsibility: responsibility as FieldResponsibility,
          columns: block.columns === 3 ? 3 : 2,
          variantKey,
        };
      }
      case "numbered_list": {
        const key = String(block.key ?? "");
        if (!key) throw new FormDocumentError(`${where}: a numbered list needs a key`);
        claimKey(key, where);
        const responsibility = block.responsibility;
        if (!FIELD_RESPONSIBILITIES.includes(responsibility as FieldResponsibility)) {
          throw new FormDocumentError(`${where}: ${key} has an unknown responsibility`);
        }
        const count = Number(block.count ?? 0);
        if (!Number.isInteger(count) || count < 1 || count > 10) {
          throw new FormDocumentError(`${where}: ${key} needs a line count between 1 and 10`);
        }
        return {
          kind,
          key,
          label: String(block.label ?? ""),
          count,
          responsibility: responsibility as FieldResponsibility,
          ...(typeof block.help === "string" ? { help: block.help } : {}),
          variantKey,
        };
      }
      case "signature_row":
        return {
          kind,
          label: String(block.label ?? "Signature"),
          dateLabel: String(block.dateLabel ?? "Date"),
          variantKey,
        };
      case "page_break":
        return { kind, variantKey };
      case "reference":
        return {
          kind,
          label: String(block.label ?? ""),
          body: Array.isArray(block.body) ? block.body.map((line) => String(line)) : [],
          variantKey,
        };
      default:
        throw new FormDocumentError(`${where}: unhandled block kind "${kind}"`);
    }
  });

  return { paper: "letter", blocks: parsed };
}

export function parseFormVariants(raw: unknown): FormVariant[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw new FormDocumentError("Variants must be a list");
  return raw.map((entry, index) => {
    if (!isRecord(entry)) throw new FormDocumentError(`variant ${index}: must be an object`);
    const key = String(entry.key ?? "");
    if (!key) throw new FormDocumentError(`variant ${index}: needs a key`);
    return {
      key,
      label: String(entry.label ?? key),
      role: String(entry.role ?? ""),
      roleAbbr: String(entry.roleAbbr ?? ""),
      ...(typeof entry.reviewedPosition === "string"
        ? { reviewedPosition: entry.reviewedPosition }
        : {}),
    };
  });
}

/* ------------------------------------------------------------ traversal --- */

/**
 * The document as one variant reads it.
 *
 * Blocks with no `variantKey` belong to every reading; blocks that name one
 * appear only for that variant. This is how the DMIT EPP prints the TSD
 * position description for a TSD review and the DMIT one for a DMIT review
 * without being two documents that can drift apart.
 */
/**
 * Whether one block prints for a given reading of the form.
 *
 * Exported as a predicate, not only as a filtered list, because the editor has
 * to keep each block's index in the WHOLE document while showing only the ones
 * this reading prints — an edit or a reorder writes back to the real position,
 * and filtering first would silently target the wrong block.
 */
export function blockAppliesToVariant(block: FormBlock, variantKey: string | null): boolean {
  return !block.variantKey || block.variantKey === variantKey;
}

export function blocksForVariant(
  document: FormDocument,
  variantKey: string | null,
): FormBlock[] {
  return document.blocks.filter((block) => blockAppliesToVariant(block, variantKey));
}

/** Every field in document order, for a given variant. */
export function fieldsForVariant(
  document: FormDocument,
  variantKey: string | null,
): FormField[] {
  const fields: FormField[] = [];
  for (const block of blocksForVariant(document, variantKey)) {
    if (block.kind === "field") fields.push(block.field);
    else if (block.kind === "field_row") fields.push(...block.fields);
  }
  return fields;
}

export interface CheckboxFacet {
  key: string;
  label: string;
  options: CheckboxOption[];
  responsibility: FieldResponsibility;
}

export function checkboxGroupsForVariant(
  document: FormDocument,
  variantKey: string | null,
): CheckboxFacet[] {
  return blocksForVariant(document, variantKey)
    .filter((block): block is Extract<FormBlock, { kind: "checkbox_group" }> =>
      block.kind === "checkbox_group",
    )
    .map((block) => ({
      key: block.key,
      label: block.label ?? "",
      options: block.options,
      responsibility: block.responsibility,
    }));
}

export function numberedListsForVariant(
  document: FormDocument,
  variantKey: string | null,
): Extract<FormBlock, { kind: "numbered_list" }>[] {
  return blocksForVariant(document, variantKey).filter(
    (block): block is Extract<FormBlock, { kind: "numbered_list" }> =>
      block.kind === "numbered_list",
  );
}

/**
 * Every writable key and what may write it, for one variant.
 *
 * The one map the fill screen, the assistant guard and the PDF renderer all
 * agree on. Signature keys are absent by construction: a signature line has no
 * key at all, because there is nothing that could ever be stored in it.
 */
export function responsibilityMap(
  document: FormDocument,
  variantKey: string | null,
): Map<string, FieldResponsibility> {
  const map = new Map<string, FieldResponsibility>();
  for (const field of fieldsForVariant(document, variantKey)) {
    map.set(field.key, field.responsibility);
  }
  for (const group of checkboxGroupsForVariant(document, variantKey)) {
    map.set(group.key, group.responsibility);
  }
  for (const list of numberedListsForVariant(document, variantKey)) {
    map.set(list.key, list.responsibility);
  }
  return map;
}

/* ------------------------------------------------------- interpolation --- */

/**
 * Resolves `{{role}}` and `{{roleAbbr}}` against the chosen variant.
 *
 * An unknown placeholder is LEFT ALONE rather than blanked. A form that prints
 * "{{roleAbbr}}" is visibly wrong and gets fixed; a form that prints an empty
 * space reads as finished and is not.
 */
export function interpolate(text: string, variant: FormVariant | null): string {
  if (!text.includes("{{")) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    if (!variant) return match;
    if (name === "role") return variant.role || match;
    if (name === "roleAbbr") return variant.roleAbbr || match;
    if (name === "reviewedPosition") return variant.reviewedPosition || match;
    return match;
  });
}

/** The same, applied to every human-readable string in a block. */
export function interpolateBlock(block: FormBlock, variant: FormVariant | null): FormBlock {
  switch (block.kind) {
    case "letterhead":
      return { ...block, title: interpolate(block.title, variant) };
    case "section":
      return { ...block, label: interpolate(block.label, variant) };
    case "paragraph":
    case "note":
    case "acknowledgement":
      return { ...block, text: interpolate(block.text, variant) };
    case "field":
      return { ...block, field: { ...block.field, label: interpolate(block.field.label, variant) } };
    case "field_row":
      return {
        ...block,
        fields: block.fields.map((field) => ({
          ...field,
          label: interpolate(field.label, variant),
        })),
      };
    case "checkbox_group":
      return {
        ...block,
        ...(block.label ? { label: interpolate(block.label, variant) } : {}),
        options: block.options.map((option) => ({
          ...option,
          label: interpolate(option.label, variant),
        })),
      };
    case "numbered_list":
      return { ...block, label: interpolate(block.label, variant) };
    case "reference":
      return {
        ...block,
        label: interpolate(block.label, variant),
        body: block.body.map((line) => interpolate(line, variant)),
      };
    default:
      return block;
  }
}

/** The document as it reads for one variant, placeholders resolved. */
export function renderDocument(
  document: FormDocument,
  variant: FormVariant | null,
): FormBlock[] {
  return blocksForVariant(document, variant?.key ?? null).map((block) =>
    interpolateBlock(block, variant),
  );
}
