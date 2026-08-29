import { NextResponse } from "next/server";

import { AiError } from "@/lib/ai/errors";
import { getAnthropicClient } from "@/lib/ai/anthropic";
import { assertLiveMode, errorResponse } from "@/lib/api/respond";
import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from "@/lib/config/models";
import { ACTIVE_BRAND } from "@/lib/brand";
import {
  applyFillRules,
  fillCheckboxDefaults,
  writableFieldIds,
} from "@/lib/forms/chat-flow";
import type { FormDraftRequest, FormDraftResponse } from "@/lib/ai/types";

/**
 * POST /api/forms/draft
 *
 * Claude drafts the prose of AI-populatable form fields. It does NOT choose the
 * template, the field list, or which fields it may write.
 *
 * The guard is structural and runs on the model's output, not before it:
 * `applyFillRules` keeps only fields the template marks `ai_populate` and drops
 * every signature field regardless of marking. Whatever the model returns, a
 * signature line stays blank.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertLiveMode();

    const body = (await request.json().catch(() => null)) as FormDraftRequest | null;
    if (!body?.templateId || !Array.isArray(body.fields)) {
      throw new AiError("bad_request", "A form template and its fields are required.", 400);
    }

    const writable = writableFieldIds(body.fields);
    if (writable.length === 0) {
      return NextResponse.json({ values: {}, checkedOptions: body.input.selections ?? {} });
    }

    const drafted = await draftWithClaude(body, writable);

    const response: FormDraftResponse = {
      values: applyFillRules(body.fields, drafted),
      checkedOptions: fillCheckboxDefaults(
        body,
        body.input.selections ?? {},
        body.input.topic ?? "",
      ),
    };

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error);
  }
}

async function draftWithClaude(
  request: FormDraftRequest,
  writable: string[],
): Promise<Record<string, string>> {
  const { input } = request;

  const fieldGuide = request.fields
    .filter((field) => writable.includes(field.id))
    .map(
      (field) =>
        `- ${field.id} (${field.label}${field.helpText ? `: ${field.helpText}` : ""})`,
    )
    .join("\n");

  const tool = {
    name: "write_form_fields",
    description:
      "Write the manager-facing text for each editable field of the form. Every value is a draft the manager will review and edit before signing.",
    strict: true,
    input_schema: {
      type: "object" as const,
      properties: Object.fromEntries(
        writable.map((id) => [id, { type: "string" as const }]),
      ),
      required: writable,
      additionalProperties: false,
    },
  };

  try {
    const response = await getAnthropicClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS.detailed,
      system: `You draft ${ACTIVE_BRAND.brandName} manager forms. Write in the manager's voice: specific, factual, and about observed behaviour rather than character. Use only what the manager told you — never invent dates, incidents, witnesses or policy citations. Where a detail is missing, write text that prompts the manager to supply it rather than inventing one. This document may end up in an employment file.`,
      tools: [tool],
      tool_choice: { type: "tool", name: "write_form_fields" },
      messages: [
        {
          role: "user",
          content: `Draft the "${request.templateName}" form.

Fields to write:
${fieldGuide}

What the manager provided:
- Employee: ${input.employeeName || "(not given)"}
- Role: ${input.employeeRole || "(not given)"}
- Location: ${input.locationName}
- Manager: ${input.managerName}
- Form date: ${input.formDate}
- Topic: ${input.topic || "(not given)"}
- What happened: ${input.incidentDetails || "(not given)"}
- Follow-up date: ${input.followUpDate || "(not given)"}`,
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Extract<typeof block, { type: "tool_use" }> =>
        block.type === "tool_use",
    );

    if (!toolUse) {
      throw new AiError("model_failed", "Sunny could not draft this form.", 502);
    }

    // Tool input arrives as parsed JSON; coerce defensively rather than trust
    // the shape, then let applyFillRules decide what is allowed through.
    const raw = toolUse.input as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const id of writable) {
      const value = raw[id];
      if (typeof value === "string" && value.trim()) values[id] = value.trim();
    }
    return values;
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError("model_failed", "Sunny could not draft this form.", 502);
  }
}
