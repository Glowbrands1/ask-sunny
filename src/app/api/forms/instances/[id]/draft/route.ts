import { NextResponse } from "next/server";

import { getAnthropicClient } from "@/lib/ai/anthropic";
import { AiError } from "@/lib/ai/errors";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { ACTIVE_BRAND } from "@/lib/brand";
import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from "@/lib/config/models";
import { authorizeInstance, InstanceNotVisibleError } from "@/lib/forms/instance-scope";
import { parseFormVariants, interpolate, type FormField } from "@/lib/forms/document";
import { applyAssistantDraft } from "@/lib/forms/instances";
import {
  draftableCheckboxGroups,
  draftableFields,
  draftableNumberedLists,
} from "@/lib/forms/responsibility";
import { stripPlaceholdersFromDraft } from "@/lib/forms/drafted-text";
import {
  EXPECTATION_LABEL,
  NEXT_STEP_LABEL,
  OBSERVED_EXPECTATION,
  OBSERVED_LABEL,
  guardNarrativeDraft,
} from "@/lib/forms/narrative-draft";
import {
  dropUngroundedPolicy,
  groundPolicy,
  groundingNotice,
  provenanceFor,
} from "@/lib/forms/policy-grounding";

/**
 * POST /api/forms/instances/[id]/draft
 *
 * Ask Sunny drafts a form the manager has already started. It is the SAME
 * assistant as the rest of the app — same client, same model configuration —
 * doing a different job, not a second chatbot.
 *
 * WHAT THE MODEL IS AND IS NOT TRUSTED WITH:
 *
 *   The field list comes from the STORED TEMPLATE VERSION, not from the
 *   request. A client cannot widen what may be written by sending a longer
 *   list, which is exactly what the previous prototype allowed.
 *
 *   Only fields the template marks `ai` are described to it, and whatever comes
 *   back is filtered again by `applyAssistantDraft` before anything is stored.
 *   Signature fields have no key to address in the first place.
 *
 *   Policy-quoting fields are drafted only from retrieved approved policy. When
 *   retrieval finds nothing, those fields are withheld — the response says so
 *   and the manager writes them. An invented policy quotation on a disciplinary
 *   record is the single worst thing this feature could produce.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface DraftBody {
  /** What the manager described, in their own words. */
  notes?: string;
  topic?: string;
}

function fieldBrief(field: FormField, variantLabel: string | null): string {
  const label = interpolate(field.label, null).replace(/\{\{\w+\}\}/g, variantLabel ?? "the employee");
  const help = field.help ? ` (${field.help})` : "";
  const grounded = field.policyGrounded ? " [quote approved policy only]" : "";
  const narrative = field.narrative ? ` [${field.narrative}]` : "";
  return `- ${field.key}: ${label}${help}${grounded}${narrative}`;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const { id } = await context.params;
    /*
     * The TEMPLATE'S OWN permission, and the form's salon. This asked for
     * `create_coaching_form` on every template, so a role that may draft a
     * coaching form could have Ask Sunny write into a Disciplinary Plan of
     * Action — at any salon, on a guessed UUID.
     */
    const { actor, loaded } = await authorizeInstance(request, id, "edit");
    assertWithinRateLimit(request, "chat");

    if (loaded.instance.status !== "draft") {
      return NextResponse.json(
        { error: "This form is finalized. Create a revision to change it." },
        { status: 409 },
      );
    }

    const body = ((await request.json().catch(() => null)) ?? {}) as DraftBody;
    const notes = String(body.notes ?? "").trim().slice(0, 4000);
    if (notes.length < 10) {
      throw new AiError(
        "bad_request",
        "Tell Ask Sunny what happened before asking for a draft.",
        400,
      );
    }

    const document = loaded.version.document;
    const variantKey = loaded.instance.variantKey;
    const variant =
      parseFormVariants(loaded.version.variants).find((entry) => entry.key === variantKey) ?? null;

    const fields = draftableFields(document, variantKey);
    const groups = draftableCheckboxGroups(document, variantKey);
    const lists = draftableNumberedLists(document, variantKey);
    if (fields.length === 0 && groups.length === 0 && lists.length === 0) {
      return NextResponse.json({ values: {}, checked: {}, withheld: [], notice: null });
    }

    /*
     * Policy is retrieved from the MANAGER'S words, before the model runs — so
     * the quotation the model is allowed to use cannot be steered by anything
     * the model itself produced.
     */
    const needsPolicy = fields.some((field) => field.policyGrounded);
    const grounding = needsPolicy
      ? await groundPolicy(`${body.topic ?? ""} ${notes}`.trim())
      : { passages: [], sources: [], unverified: false, reason: null };

    const policyBlock = grounding.passages.length
      ? `\nAPPROVED POLICY (quote only from this, verbatim):\n${grounding.passages
          .map((passage) => `[${passage.source.documentTitle} ${passage.source.locator}]\n${passage.text}`)
          .join("\n\n")}`
      : needsPolicy
        ? "\nAPPROVED POLICY: none found. Leave every policy field empty."
        : "";

    const system = [
      `You prepare drafts of ${ACTIVE_BRAND.brandName} management forms for a manager to review.`,
      "You are drafting, not deciding. A manager edits everything you write and signs it.",
      "Write plainly, specifically, and only from what the manager described.",
      "Never invent dates, figures, policy names or policy wording.",
      /*
       * SAID EXPLICITLY BECAUSE THE MODEL DID IT. A bracketed placeholder is
       * how a language model writes "somebody fills this in later", and on a
       * form that is exactly the wrong instinct: the field IS the place it gets
       * filled in.
       */
      "Never write a placeholder such as [Follow-Up Date] or [Employee Name]. If you do not have a value, leave the field empty.",
      "Do not mention follow-up dates or scheduling at all: the follow-up date is recorded separately by the manager, not in these fields.",
      "If you cannot support a field from what you were given, return it empty.",
      "Return only the fields you were asked for.",
      /*
       * THE OBSERVED / EXPECTATION SHAPE, asked for only by the fields whose
       * stored version requests it. A record that names the event and not the
       * expectation cannot show that anything was communicated to the employee.
       */
      `A field marked [${OBSERVED_EXPECTATION}] is written as two labelled sections and nothing else:`,
      `"${OBSERVED_LABEL}" on its own line, then what happened;`,
      `a blank line; then "${EXPECTATION_LABEL}" on its own line, then the expectation the manager told the employee.`,
      `Add "${NEXT_STEP_LABEL}" only when the manager described an action they agreed with the employee.`,
      "THE EXPECTATION MUST BE THE MANAGER'S OWN. Restate what the manager said they told the employee, keeping their specifics — if they said ten minutes before opening, do not write it as a general standard.",
      `If the manager did not say what they expect, write the "${OBSERVED_LABEL}" section alone and stop. Never supply an expectation of your own.`,
      "Never add a number of prior occurrences, a consequence, a warning level, a policy requirement, an amount or a date that the manager did not give you.",
    ].join(" ");

    const prompt = [
      `FORM: ${loaded.instance.templateName}`,
      variant ? `REVIEWER: ${variant.role}. SUBJECT: ${variant.roleAbbr}.` : "",
      `EMPLOYEE: ${loaded.instance.employeeName}`,
      loaded.instance.locationName ? `LOCATION: ${loaded.instance.locationName}` : "",
      "",
      "WHAT THE MANAGER DESCRIBED:",
      notes,
      policyBlock,
      "",
      "FIELDS YOU MAY WRITE:",
      ...fields.map((field) => fieldBrief(field, variant?.roleAbbr ?? null)),
      ...lists.map(
        (list) =>
          `- ${list.key}: ${interpolate(list.label, variant)} (up to ${list.count} items, one per line)`,
      ),
      "",
      groups.length
        ? `CHECKBOXES YOU MAY TICK (use the option keys):\n${groups
            .map(
              (group) =>
                `- ${group.key}: ${group.options.map((option) => `${option.key} = ${option.label}`).join("; ")}`,
            )
            .join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS.detailed,
      system,
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          name: "write_form_fields",
          description: "Write the drafted values for the fields you were given.",
          input_schema: {
            type: "object",
            properties: {
              values: {
                type: "object",
                additionalProperties: { type: "string" },
                description: "Field key to drafted text. Omit a field you cannot support.",
              },
              checked: {
                type: "object",
                additionalProperties: { type: "array", items: { type: "string" } },
                description: "Checkbox group key to the option keys that apply.",
              },
            },
            required: ["values"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "write_form_fields" },
    });

    const call = response.content.find(
      (block): block is Extract<typeof block, { type: "tool_use" }> => block.type === "tool_use",
    );
    const drafted = (call?.input ?? {}) as {
      values?: Record<string, string>;
      checked?: Record<string, string[]>;
    };

    /*
     * UNRESOLVED PLACEHOLDERS GO BEFORE ANYTHING IS STORED.
     *
     * Asked to draft Details, the model wrote "I will check in with Sarah on
     * [Follow-Up Date]" — and that string became a canonical field value, an
     * editor row and a line in the printed PDF. The prompt already forbids it;
     * this is the guard that runs on what came back, because a model
     * instruction is a request and not a boundary.
     *
     * See `lib/forms/drafted-text.ts` for why the whole sentence goes rather
     * than the bracket, and why follow-up belongs to instance metadata rather
     * than to a paragraph in Details.
     */
    const cleaned = stripPlaceholdersFromDraft(drafted.values ?? {});

    /*
     * THEN THE NARRATIVE GUARD, on the fields whose stored version asks for the
     * Observed/Expectation shape.
     *
     * Run against the MANAGER'S OWN NOTES, which is what makes it a grounding
     * check rather than a style check: a date, an amount, a count of prior
     * occurrences or a disciplinary consequence survives only if the manager
     * supplied it, and an Expectation section survives only if their words
     * carried an expectation at all. Scheduling talk goes unconditionally —
     * follow-up is instance metadata with its own control, and a sentence
     * narrating it here is the same failure as `[Follow-Up Date]` without the
     * brackets. See `lib/forms/narrative-draft`.
     */
    const narrated = guardNarrativeDraft(cleaned.values, fields, notes);

    // The template's own rules, applied to the model's output.
    const guarded = await applyAssistantDraft(
      id,
      { values: narrated.values, checked: drafted.checked ?? {} },
      actor.id,
      provenanceFor(fields, narrated.values, grounding),
    );

    // Then the policy rule, which can withhold a field the template allowed.
    const policyChecked = dropUngroundedPolicy(fields, guarded.accepted.values, grounding);

    if (policyChecked.withheld.length > 0) {
      /*
       * The values were already written by `applyAssistantDraft`, so withholding
       * means clearing them again rather than not writing them. Done as an
       * explicit blanking so the audit trail shows what was proposed and
       * removed, instead of the record simply never mentioning it.
       */
      await applyAssistantDraft(
        id,
        { values: Object.fromEntries(policyChecked.withheld.map((key) => [key, ""])) },
        actor.id,
      );
    }

    return NextResponse.json({
      values: policyChecked.values,
      checked: guarded.accepted.checked,
      withheld: policyChecked.withheld,
      rejected: guarded.rejected,
      /** Fields the placeholder guard rewrote, and those it emptied entirely. */
      placeholders: { cleaned: cleaned.cleaned, emptied: cleaned.emptied },
      /** Same, for the ungrounded-narrative guard. */
      narrative: { adjusted: narrated.adjusted, emptied: narrated.emptied },
      notice: groundingNotice(grounding),
      sources: grounding.sources,
    });
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return errorResponse(error, "forms/instance/draft");
  }
}
