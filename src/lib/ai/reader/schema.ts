import { z } from "zod";

/**
 * ============================================================================
 * AI_READS_CODE_CHECKS_ENABLED — WHAT THE MODEL RETURNS
 * ============================================================================
 *
 * Every field comes with `evidence`: the manager's own words the value was
 * read from, copied exactly. `check.ts` keeps a field only when that quote is
 * in the manager's turns and the value agrees with it, so a value the model
 * made up has no quote and is dropped.
 */

export const READER_TOOL_NAME = "record_form_reading";

export const READER_TOOL_DESCRIPTION =
  "Record the form fields the manager stated, each with the exact words of theirs it came from. Do not invent a value.";

const fieldSchema = z
  .object({ value: z.string().nullable().optional(), evidence: z.string().nullable().optional() })
  .nullable()
  .optional()
  .transform((field) => ({ value: blank(field?.value), evidence: blank(field?.evidence) }));

const datedSchema = z
  .object({
    kind: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    date: z.string().nullable().optional(),
    evidence: z.string().nullable().optional(),
  })
  .transform((row) => ({
    kind: blank(row.kind ?? row.role),
    date: blank(row.date),
    evidence: blank(row.evidence),
  }));

export const readingSchema = z
  .object({
    employee: fieldSchema,
    location: fieldSchema,
    jobTitle: fieldSchema,
    incident: fieldSchema,
    incidentDate: fieldSchema,
    warningLevel: fieldSchema,
    payroll: fieldSchema,
    payrollAmount: fieldSchema,
    policyHeading: fieldSchema,
    priorSteps: z.array(datedSchema).nullable().optional(),
    otherDates: z.array(datedSchema).nullable().optional(),
  })
  .transform((value) => ({ ...value, priorSteps: value.priorSteps ?? [], otherDates: value.otherDates ?? [] }));

export type FormReading = z.infer<typeof readingSchema>;
export type ReadField = FormReading["employee"];

export function parseFormReading(raw: unknown): FormReading | null {
  const parsed = readingSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const field = (value: string) => ({
  type: ["object", "null"],
  additionalProperties: false,
  required: ["value", "evidence"],
  properties: {
    value: { type: ["string", "null"], description: value },
    evidence: {
      type: ["string", "null"],
      description: "The manager's own words this value was read from, copied exactly. Null when they did not state it.",
    },
  },
});

const dated = (kind: string) => ({
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "date", "evidence"],
    properties: {
      kind: { type: "string", description: kind },
      date: { type: "string", description: "YYYY-MM-DD." },
      evidence: { type: "string", description: "The manager's own words that state this date, copied exactly." },
    },
  },
});

export const READER_TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "employee",
    "location",
    "jobTitle",
    "incident",
    "incidentDate",
    "warningLevel",
    "payroll",
    "payrollAmount",
    "policyHeading",
    "priorSteps",
    "otherDates",
  ],
  properties: {
    employee: field("The employee's name exactly as the manager typed it, nothing else."),
    location: field("The location the manager named, as they wrote it."),
    jobTitle: field("The employee's job title the manager stated."),
    incident: field("What the employee did, in a few words."),
    incidentDate: field("The date the incident happened, YYYY-MM-DD. Not a prior step's date, not a follow-up or meeting date."),
    warningLevel: field("verbal or written: the level of THIS form, only when the manager said it."),
    payroll: field("yes or no: whether payroll deduct applies, only when the manager said it."),
    payrollAmount: field("A dollar amount to deduct from payroll, digits only, like 25 or 3.25."),
    policyHeading: field("The one heading from the manual list in the message that the incident is about, copied exactly."),
    priorSteps: dated("verbal, written, coaching, manual_ack or other: an earlier step taken with this employee."),
    otherDates: dated("followup, meeting, notice or other: a date in the request that is not the incident date."),
  },
};

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
