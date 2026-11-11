import { z } from "zod";
import { z as z4 } from "zod/v4";

/**
 * What a form-understanding tool call must return.
 *
 * The model proposes an intent and fields. Callers parse with this schema
 * and then run the existing readers as validators — a value that is not in
 * the manager's words does not survive that step.
 */

export const FORM_TOOL_NAME = "record_form_turn";

const templateKeySchema = z.enum(["dpoa", "coaching", "stc-exit"]);

const intentSchema = z.enum([
  "create_form",
  "continue_form",
  "confirm",
  "provide_fields",
  "correct_fields",
  "form_command",
  "policy_question",
  "other",
]);

const fieldsSchema = z
  .object({
    employeeName: z.string().nullable().optional(),
    jobTitle: z.string().nullable().optional(),
    salon: z.string().nullable().optional(),
    incidentDateIso: z.string().nullable().optional(),
    useToday: z.boolean().optional(),
    payrollDeduct: z.enum(["yes", "no"]).nullable().optional(),
    payrollAmount: z.string().nullable().optional(),
    warningLevel: z.enum(["verbal", "written"]).nullable().optional(),
    policySection: z.string().nullable().optional(),
    deadline: z.string().nullable().optional(),
  })
  .optional();

export const formToolTurnSchema = z
  .object({
    intent: intentSchema,
    templateKey: templateKeySchema.nullable().optional(),
    confirmsOpenForm: z.boolean().optional(),
    fields: fieldsSchema,
  })
  .transform((value) => ({
    intent: value.intent,
    templateKey: value.templateKey ?? null,
    confirmsOpenForm: value.confirmsOpenForm ?? false,
    fields: {
      employeeName: value.fields?.employeeName ?? null,
      jobTitle: value.fields?.jobTitle ?? null,
      salon: value.fields?.salon ?? null,
      incidentDateIso: value.fields?.incidentDateIso ?? null,
      useToday: value.fields?.useToday ?? false,
      payrollDeduct: value.fields?.payrollDeduct ?? null,
      payrollAmount: value.fields?.payrollAmount ?? null,
      warningLevel: value.fields?.warningLevel ?? null,
      policySection: value.fields?.policySection ?? null,
      deadline: value.fields?.deadline ?? null,
    },
  }));

export type FormToolTurn = z.infer<typeof formToolTurnSchema>;

export function parseFormToolTurn(input: unknown): FormToolTurn | null {
  const parsed = formToolTurnSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** JSON schema sent to Claude. Kept beside the zod schema; a test checks the keys agree. */
export const FORM_TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: ["intent", "confirmsOpenForm", "fields"],
  properties: {
    intent: {
      type: "string",
      enum: [
        "create_form",
        "continue_form",
        "confirm",
        "provide_fields",
        "correct_fields",
        "form_command",
        "policy_question",
        "other",
      ],
      description:
        "create_form, continue_form, confirm, provide_fields, correct_fields, or form_command when the manager is doing a form, including slang and short confirmations. policy_question when they ask what a policy says. other otherwise.",
    },
    templateKey: {
      type: ["string", "null"],
      enum: ["dpoa", "coaching", "stc-exit", null],
      description:
        "dpoa for a corrective action, CA, or write-up; coaching for a coaching form; stc-exit for an exit form; null when no form is settled.",
    },
    confirmsOpenForm: {
      type: "boolean",
      description: "True for yes, go ahead, ok make it, yep, and the same kind of confirmation.",
    },
    fields: {
      type: "object",
      additionalProperties: false,
      required: [
        "employeeName",
        "jobTitle",
        "salon",
        "incidentDateIso",
        "useToday",
        "payrollDeduct",
        "payrollAmount",
        "warningLevel",
        "policySection",
        "deadline",
      ],
      properties: {
        employeeName: { type: ["string", "null"] },
        jobTitle: { type: ["string", "null"] },
        salon: { type: ["string", "null"] },
        incidentDateIso: {
          type: ["string", "null"],
          description: "YYYY-MM-DD only when the manager stated a calendar date. Otherwise null.",
        },
        useToday: {
          type: "boolean",
          description: "True only when the manager said to use today's date.",
        },
        payrollDeduct: { type: ["string", "null"], enum: ["yes", "no", null] },
        payrollAmount: {
          type: ["string", "null"],
          description: "A dollar amount the manager stated, or null. Never invent one.",
        },
        warningLevel: { type: ["string", "null"], enum: ["verbal", "written", null] },
        policySection: { type: ["string", "null"] },
        deadline: {
          type: ["string", "null"],
          description: "Only a deadline the manager stated, in their words. Otherwise null.",
        },
      },
    },
  },
};

export const FORM_TOOL_DESCRIPTION =
  "Record the manager's form intent and any fields they have actually stated in the conversation. Do not invent names, dates, amounts, or deadlines.";

/* ------------------------------------------------------------ edit_form -- */

/**
 * FORM_EDIT_TOOL_IN_STREAM_ENABLED (Step 3, 4 Nov 2026; ported from Ask
 * Bubbles): the one tool the main answering call is offered while a draft form
 * is open. Additive: the tools above are unchanged. Built with zod v4, as the
 * form-patch schema is, so it is sent as `z.toJSONSchema`.
 */
export const EDIT_FORM_TOOL_NAME = "edit_form";

/** The owner's approved wording (Pau, 4 Nov 2026), verbatim — the same in both apps. */
export const EDIT_FORM_TOOL_DESCRIPTION =
  'Edit the HR form that is open in this chat. Use this tool only when the manager\'s latest message asks to add to, change or remove something on that form. Each op names one field key from the open form provided with this message. Use "append" to add the manager\'s own words to a text field, "set" only to replace a value the manager asked to change, and "clear" only when the manager asked to remove a value. Never touch a field the manager did not mention. Never invent names, dates, amounts or details; copy them as the manager gave them. If the message asks a question instead of asking for a change, do not use this tool.';

/** At most this many ops in one call. */
export const EDIT_FORM_MAX_OPS = 20;

/**
 * The tool's input: `{ ops: [...] }`, each op `set`, `clear` or `append` on
 * one of the open form's writable keys. A checkbox field's value is its
 * option keys; a text field's, the text. Strict: an extra key is a failed
 * parse, and the turn goes on as if the tool had not been called.
 */
export function editFormSchema(keys: readonly [string, ...string[]]) {
  const field = z4.enum(keys);
  const value = z4.union([z4.string().max(4000), z4.array(z4.string().max(200)).max(20)]);
  return z4
    .object({
      ops: z4
        .array(
          z4.union([
            z4.object({ op: z4.literal("set"), field, value }).strict(),
            z4.object({ op: z4.literal("append"), field, value: z4.string().min(1).max(4000) }).strict(),
            z4.object({ op: z4.literal("clear"), field }).strict(),
          ]),
        )
        .min(1)
        .max(EDIT_FORM_MAX_OPS),
    })
    .strict();
}

export type EditFormInput = z4.infer<ReturnType<typeof editFormSchema>>;

/** The tool as the Messages API takes it: the schema sent as `z.toJSONSchema`. */
export function editFormTool(keys: readonly [string, ...string[]]): {
  readonly name: string;
  readonly description: string;
  readonly input_schema: { readonly type: "object" } & Record<string, unknown>;
} {
  const { $schema: _dropped, ...schema } = z4.toJSONSchema(editFormSchema(keys)) as Record<string, unknown>;
  void _dropped;
  return { name: EDIT_FORM_TOOL_NAME, description: EDIT_FORM_TOOL_DESCRIPTION, input_schema: { ...schema, type: "object" } };
}
