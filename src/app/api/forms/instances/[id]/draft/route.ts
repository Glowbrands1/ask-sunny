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
import { authorizeForms } from "@/lib/forms/access";
import { parseFormVariants, interpolate, type FormField } from "@/lib/forms/document";
import { applyAssistantDraft, loadInstance } from "@/lib/forms/instances";
import {
  draftableCheckboxGroups,
  draftableFields,
  draftableNumberedLists,
} from "@/lib/forms/responsibility";
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
  return `- ${field.key}: ${label}${help}${grounded}`;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const actor = await authorizeForms(request, "create_coaching_form");
    assertWithinRateLimit(request, "chat");

    const { id } = await context.params;
    const loaded = await loadInstance(id);
    if (!loaded) return NextResponse.json({ error: "No such form." }, { status: 404 });
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
      "If you cannot support a field from what you were given, return it empty.",
      "Return only the fields you were asked for.",
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

    // The template's own rules, applied to the model's output.
    const guarded = await applyAssistantDraft(
      id,
      { values: drafted.values ?? {}, checked: drafted.checked ?? {} },
      actor.id,
      provenanceFor(fields, drafted.values ?? {}, grounding),
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
      notice: groundingNotice(grounding),
      sources: grounding.sources,
    });
  } catch (error) {
    return errorResponse(error, "forms/instance/draft");
  }
}
