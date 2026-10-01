import "server-only";

import { getAnthropicClient } from "@/lib/ai/anthropic";
import type { AskResponse } from "@/lib/ai/types";
import { ACTIVE_BRAND } from "@/lib/brand";
import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from "@/lib/config/models";
import type { ChatMessage } from "@/types";

import {
  COACHING_CONTEXT_RULES,
  LANGUAGE_CLEANUP_RULES,
  guardCoachingFraming,
} from "./coaching-framing";
import { interpolate, parseFormDocument } from "./document";
import { stripPlaceholdersFromDraft } from "./drafted-text";
import { refuseSensitiveSelections } from "./escalation-guard";
import {
  MANAGER_FOLLOW_UP_GROUP_KEYS,
  MANAGER_FOLLOW_UP_RULES,
  MANAGER_FOLLOW_UP_TEXT_KEYS,
  guardManagerFollowUp,
  hasManagerFollowUpKeys,
} from "./follow-up-observation";
import { FOLLOW_UP_TIMEFRAME_RULES, guardFollowUpTimeframe } from "./follow-up-timeframe";
import { authorizeInstance } from "./instance-scope";
import { applyAssistantRevision } from "./instances";
import {
  EXPECTATION_LABEL,
  GOING_FORWARD_LABEL,
  OBSERVED_EXPECTATION,
  OBSERVED_LABEL,
  guardNarrativeDraft,
} from "./narrative-draft";
import { extractEmployeeNames, managerContext, samePerson } from "./proposal";
import { draftableCheckboxGroups, draftableFields } from "./responsibility";
import {
  REVISABLE_LAYOUT_FAMILIES,
  fieldsNamedIn,
  isRevisionRequest,
  planRevision,
  type CurrentValue,
} from "./revision";
import { TEAM_SUBJECT_RULES, isTeamSubject } from "./team-subject";
import { detectTemplateIntent } from "./template-intent";

/**
 * ============================================================================
 * "REDRAFT IT WITH THESE CHANGES" — ON THE FORM THAT IS OPEN
 * ============================================================================
 *
 * Tried by the chat route after `correctActiveForm` and before an ordinary
 * answer, only where the browser named a form this conversation created.
 * Returns null for anything that is not a revision of a coaching document, and
 * the turn is answered exactly as it would have been. See `revision.ts` for
 * the rules about what a revision may change.
 *
 * EVERYTHING IS RE-CHECKED. The browser names the instance; this loads it and
 * runs `authorizeInstance` with "edit" — the template's own permission and the
 * salon scope, exactly as the inline editor's save does.
 *
 * THE SAME GUARDS AS THE FIRST DRAFT, on the output, before anything is
 * stored: placeholders, the narrative grounding check, the follow-up timeframe,
 * the manager's follow-up findings, the coaching register, and the leadership-
 * authority guard on the checkboxes.
 */
export async function reviseActiveForm(input: {
  request: Request;
  instanceId: string;
  question: string;
  history: Pick<ChatMessage, "id" | "role" | "content" | "error">[];
}): Promise<AskResponse | null> {
  if (!isRevisionRequest(input.question)) return null;

  let authorized: Awaited<ReturnType<typeof authorizeInstance>>;
  try {
    authorized = await authorizeInstance(input.request, input.instanceId, "edit");
  } catch {
    return null;
  }
  const { actor, loaded } = authorized;
  const instance = loaded.instance;
  if (!REVISABLE_LAYOUT_FAMILIES.has(instance.layoutFamily)) return null;

  /*
   * A REQUEST FOR A DIFFERENT DOCUMENT, OR ABOUT A DIFFERENT PERSON, IS NOT A
   * REVISION OF THIS ONE. Naming "coaching form" while the Follow-Up Coaching
   * Form is open IS a revision — the same family, and the form on screen is
   * the one they mean. That is precisely the case that used to start a new
   * record with a different template and lose the follow-up fields.
   */
  const intent = detectTemplateIntent(input.question);
  if (intent.kind === "corrective_action") return null;
  // "Update the EPP" names a different family of form; it is not this one.
  if (intent.kind === "ambiguous" && intent.family === "epp") return null;
  if (intent.kind === "explicit" && intent.templateKey !== instance.templateKey) {
    const sameFamily =
      ["coaching", "follow-up-coaching"].includes(intent.templateKey) &&
      ["coaching", "follow-up-coaching"].includes(instance.templateKey);
    if (!sameFamily) return null;
  }
  const team = isTeamSubject(instance.employeeName);
  if (!team) {
    const named = extractEmployeeNames(input.question);
    if (named.length > 0 && !named.some((name) => samePerson(name, instance.employeeName))) return null;
  }

  const subject = team ? "the team" : `**${instance.employeeName}**`;
  const who = `**${instance.templateName}** for ${subject}`;
  if (instance.status !== "draft") {
    return reply(
      `The ${who} is finalized, so I haven't changed it. Open it from Form Monitoring and create a revision to make a change.`,
    );
  }

  const document = parseFormDocument(loaded.version.document);
  const variantKey = instance.variantKey;
  const fields = draftableFields(document, variantKey);
  const groups = draftableCheckboxGroups(document, variantKey);

  const current = new Map<string, CurrentValue>(
    loaded.values.map((row) => [
      row.fieldKey,
      { value: row.value, checked: row.checked ?? [], filledBy: row.filledBy },
    ]),
  );

  /*
   * WHAT THE MANAGER HAS SAID, IN THIS CONVERSATION — the same bounded window
   * of manager turns the first draft was written from, now including the
   * request itself. Assistant turns never reach it.
   */
  const notes = managerContext(input.history, { content: input.question }).text;
  const currentText = [...current.values()].map((entry) => entry.value ?? "").join("\n");

  const describeCurrent = [
    ...fields.map((field) => {
      const entry = current.get(field.key);
      const value = (entry?.value ?? "").trim();
      const label = interpolate(field.label, null);
      const by = entry && value ? ` [written by ${entry.filledBy === "ai" ? "Sunny" : "the manager"}]` : "";
      return `- ${field.key} (${label})${field.narrative ? ` [${field.narrative}]` : ""}: ${value ? JSON.stringify(value) : "(empty)"}${by}`;
    }),
    ...groups.map((group) => {
      const ticked = current.get(group.key)?.checked ?? [];
      return `- ${group.key} (checkbox): options ${group.options.map((option) => `${option.key} = ${option.label}`).join("; ")}. Ticked now: ${ticked.length ? ticked.join(", ") : "(none)"}`;
    }),
  ];

  const hasTimeframe = fields.some((field) => field.semantics === "follow_up_timeframe");
  const followUpKeys = hasManagerFollowUpKeys([...fields.map((f) => f.key), ...groups.map((g) => g.key)]);

  const system = [
    `You revise drafts of ${ACTIVE_BRAND.brandName} coaching forms for a manager, who reviews and signs them.`,
    "You are given the form as it stands and the manager's requested change. Make THAT change and nothing else.",
    "PRESERVE THE FORM. Return only the fields whose value the request changes. A field you leave out keeps exactly what it says now — so leave out every field the request does not ask you to change, including empty ones.",
    "Never remove or empty a field unless the manager asked for it to be removed. If they did, list its key under `clear`.",
    "Never change a field marked [written by the manager] unless the request names it.",
    "FACTS come only from what the manager said in this conversation and from the form as it stands. Never invent dates, figures, names, prior incidents, policy names or policy wording.",
    "Never write a placeholder such as [Follow-Up Date]. If you do not have a value, leave the field out.",
    ...(hasTimeframe
      ? FOLLOW_UP_TIMEFRAME_RULES
      : ["Do not mention follow-up dates or scheduling in any field: the follow-up date is recorded separately by the manager."]),
    `A field marked [${OBSERVED_EXPECTATION}] keeps its labelled sections — "${OBSERVED_LABEL}", "${EXPECTATION_LABEL}" and, where present, "${GOING_FORWARD_LABEL}" — each label on its own line.`,
    ...COACHING_CONTEXT_RULES,
    ...LANGUAGE_CLEANUP_RULES,
    ...(followUpKeys ? MANAGER_FOLLOW_UP_RULES : []),
    ...(team ? TEAM_SUBJECT_RULES : []),
    "Never select a termination, demotion or suspension.",
  ].join(" ");

  const prompt = [
    `FORM: ${instance.templateName}`,
    team
      ? "SUBJECT: the whole team. This is team-wide coaching and is not about any one employee."
      : `EMPLOYEE: ${instance.employeeName}`,
    instance.locationName ? `LOCATION: ${instance.locationName}` : "",
    "",
    "THE FORM AS IT STANDS:",
    ...describeCurrent,
    "",
    "WHAT THE MANAGER HAS SAID IN THIS CONVERSATION:",
    notes,
    "",
    "THE CHANGE THE MANAGER IS ASKING FOR NOW:",
    input.question,
  ]
    .filter((line) => line !== "")
    .join("\n");

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS.detailed,
    system,
    messages: [{ role: "user", content: prompt }],
    tools: [
      {
        name: "revise_form_fields",
        description: "Write ONLY the fields the requested change alters.",
        input_schema: {
          type: "object",
          properties: {
            values: {
              type: "object",
              additionalProperties: { type: "string" },
              description: "Field key to its new text. Only fields the request changes.",
            },
            checked: {
              type: "object",
              additionalProperties: { type: "array", items: { type: "string" } },
              description: "Checkbox group key to its new option keys. Only groups the request changes.",
            },
            clear: {
              type: "array",
              items: { type: "string" },
              description: "Keys the manager asked to have removed. Usually empty.",
            },
          },
          required: ["values"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "revise_form_fields" },
  });

  const call = response.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> => block.type === "tool_use",
  );
  const proposed = (call?.input ?? {}) as {
    values?: Record<string, unknown>;
    checked?: Record<string, unknown>;
    clear?: unknown;
  };

  /* 1. WHAT MAY CHANGE AT ALL: named fields, Sunny's own text, explicit removals. */
  const labelled = [
    ...fields.map((field) => ({ key: field.key, label: interpolate(field.label, null) })),
    ...groups.map((group) => ({ key: group.key, label: group.label ?? GROUP_LABELS[group.key] ?? group.key.replace(/_/g, " ") })),
  ];
  const plan = planRevision({ question: input.question, fields: labelled, current, proposed });

  /* 2. THE DRAFTING GUARDS, on what is left. The form's own text counts as grounded. */
  const grounding = `${notes}\n${currentText}`;
  const cleaned = stripPlaceholdersFromDraft(plan.values);
  const narrated = guardNarrativeDraft(cleaned.values, fields, grounding);
  const timeframe = guardFollowUpTimeframe(narrated.values, fields, notes);
  /*
   * A FINDING THE MANAGER STATES IS THEIRS. "Set the progress level to
   * improved" names the field and gives the decision, so it is written; a
   * finding the request does not name still needs a follow-up in their words.
   */
  const named = fieldsNamedIn(input.question, labelled);
  const guardedFollowUp = guardManagerFollowUp({ values: timeframe.values, checked: plan.checked }, notes);
  const followUp = {
    values: {
      ...guardedFollowUp.values,
      ...Object.fromEntries(
        Object.entries(timeframe.values).filter(([key]) => named.has(key) && guardedFollowUp.emptied.includes(key)),
      ),
    },
    checked: {
      ...guardedFollowUp.checked,
      ...Object.fromEntries(
        Object.entries(plan.checked).filter(([key]) => named.has(key) && guardedFollowUp.emptied.includes(key)),
      ),
    },
    emptied: guardedFollowUp.emptied.filter((key) => !named.has(key)),
  };
  const framing =
    instance.templateKey === "coaching"
      ? guardCoachingFraming({ values: followUp.values, checked: followUp.checked }, grounding)
      : { values: followUp.values, checked: followUp.checked, adjusted: [] as string[], underperformanceRefused: false };
  const sensitive = refuseSensitiveSelections({ document, variantKey, checked: framing.checked });

  const changed = Object.keys(framing.values).length + Object.keys(sensitive.checked).length;
  const refusedFindings = followUp.emptied.filter(
    (key) => MANAGER_FOLLOW_UP_TEXT_KEYS.has(key) || MANAGER_FOLLOW_UP_GROUP_KEYS.has(key),
  );

  if (changed === 0 && plan.cleared.length === 0) {
    const lines = [`I haven't changed the ${who} — everything on it is as it was.`];
    if (refusedFindings.length > 0) lines.push("", followUpNote(refusedFindings, labelled));
    else lines.push("", "Tell me which part to change and what it should say, and I'll update just that.");
    return reply(lines.join("\n"));
  }

  const saved = await applyAssistantRevision(
    input.instanceId,
    { values: framing.values, checked: sensitive.checked },
    plan.cleared,
    actor.id,
  );
  const written = [
    ...Object.keys(saved.accepted.values),
    ...Object.keys(saved.accepted.checked),
    ...saved.cleared,
  ];
  if (written.length === 0) {
    return reply(`I haven't changed the ${who} — everything on it is as it was.`);
  }

  const labelOf = (key: string) => labelled.find((entry) => entry.key === key)?.label ?? key;
  const updated = written.filter((key) => !saved.cleared.includes(key)).map(labelOf);
  const lines = [
    `Updated the ${who}${updated.length ? `: ${updated.join(", ")}` : ""}.${saved.cleared.length ? ` Removed ${saved.cleared.map(labelOf).join(", ")}.` : ""} Everything else on the form is as it was.`,
  ];
  if (refusedFindings.length > 0) lines.push("", followUpNote(refusedFindings, labelled));
  if (sensitive.anyRefused) {
    lines.push("", "I didn't tick a termination, demotion or suspension — that decision stays with leadership.");
  }
  lines.push("", "Give it a read below before you finalize.");

  return {
    ...reply(lines.join("\n")),
    formUpdate: { instanceId: input.instanceId, updated: written },
  };
}

/** The coaching documents' unlabelled groups, by the section heading they print under. */
const GROUP_LABELS: Record<string, string> = {
  coaching_type: "Type of Coaching",
  coaching_topics: "Topic of Coaching",
  next_step: "Next Step",
};

function followUpNote(keys: readonly string[], labelled: readonly { key: string; label: string }[]): string {
  const names = keys.map((key) => labelled.find((entry) => entry.key === key)?.label ?? key);
  return `${names.join(", ")} ${names.length === 1 ? "stays" : "stay"} blank until you've done the follow-up — tell me what you saw then, and I'll add it.`;
}

function reply(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}
