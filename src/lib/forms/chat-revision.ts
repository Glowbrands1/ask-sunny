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
  findingsSupportedBy,
  guardManagerFollowUp,
  hasManagerFollowUpKeys,
  notesDescribeFollowUp,
  reportsFollowUpResult,
} from "./follow-up-observation";
import { FOLLOW_UP_TIMEFRAME_RULES, guardFollowUpTimeframe } from "./follow-up-timeframe";
import { authorizeInstance } from "./instance-scope";
import { datesInText } from "./form-date-answer";
import { FollowUpError, applyAssistantRevision, setFollowUpDate } from "./instances";
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
  asksAboutFollowUpDate,
  isRevisionRequest,
  planRevision,
  scopeRevision,
  type CurrentValue,
  type RevisableField,
  type RevisionScope,
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
  /** The business day, `YYYY-MM-DD`, for reading a date the manager typed. */
  today?: string;
}): Promise<AskResponse | null> {
  /*
   * THREE KINDS OF TURN REACH THE OPEN FORM:
   *
   *   a REVISION       "change the timeframe to one week", "redraft it cleaner"
   *   a FOLLOW-UP      "Kaitlyn improved and followed the procedure correctly
   *   REPORT           during today's observation" — the findings, stated, with
   *                    no edit verb (Follow-Up Coaching Form only; see below)
   *   the DATE         "set the follow-up date to 10/15", "schedule the
   *                    follow-up for October 15" — never the timeframe field
   */
  const asksRevision = isRevisionRequest(input.question);
  const asksDate = asksAboutFollowUpDate(input.question);
  const reportsFollowUp = reportsFollowUpResult(input.question);
  if (!asksRevision && !asksDate && !reportsFollowUp) return null;

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
    /*
     * THE FORM'S OWN WORDS ARE NOT A DIFFERENT PERSON. "Change only Progress
     * Level to Partially Improved" read as naming "Progress Level", and
     * "schedule the follow-up for October 15" as naming "October" — so the
     * edit was treated as being about somebody else and dropped.
     */
    const formWords = formVocabulary(parseFormDocument(loaded.version.document), instance.variantKey);
    const named = extractEmployeeNames(input.question).filter(
      (name) =>
        !formWords.has(name.toLowerCase()) &&
        !new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+\\d{1,2}\\b`).test(input.question),
    );
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
  const followUpKeys = hasManagerFollowUpKeys([...fields.map((f) => f.key), ...groups.map((g) => g.key)]);

  /*
   * A FOLLOW-UP REPORT IS ONLY A REVISION OF A FORM WITH FINDINGS TO RECORD.
   * "She improved" with a Coaching Form open is an ordinary turn.
   */
  if (!asksRevision && !asksDate && !followUpKeys) return null;

  const labelled: RevisableField[] = [
    ...fields.map((field) => ({ key: field.key, label: interpolate(field.label, null) })),
    ...groups.map((group) => ({
      key: group.key,
      // An unlabelled group printed "Progress Level, ." — always a real name.
      label: group.label?.trim() || GROUP_LABELS[group.key] || humanize(group.key),
      options: group.options.map((option) => ({ key: option.key, label: option.label })),
    })),
  ];
  const labelOf = (key: string) =>
    key === FOLLOW_UP_DATE_KEY ? "Follow-up date" : (labelled.find((entry) => entry.key === key)?.label ?? humanize(key));

  /*
   * ==========================================================================
   * THE FOLLOW-UP DATE, BEFORE THE MODEL IS ASKED ANYTHING
   * ==========================================================================
   *
   * Through the same `setFollowUpDate` the form's own date control uses, on
   * the same `edit` authorization this function already ran — and only for
   * one real date that has not passed. Anything else is said plainly, and the
   * date is never written into Next Follow-Up. See `revision.ts`.
   */
  const dateLines: string[] = [];
  let dateChanged = false;
  if (asksDate) {
    const dates = [...new Set(datesInText(input.question, input.today ?? "").map((found) => found.iso))];
    const target = dates.length === 1 ? dates[0]! : null;
    if (!input.today || dates.length === 0) {
      dateLines.push(`${DATE_NOT_CHANGED} I couldn't tell which day you meant.`);
    } else if (!target) {
      dateLines.push(`${DATE_NOT_CHANGED} You gave more than one date, so I didn't choose between them.`);
    } else if (target < input.today) {
      dateLines.push(`${DATE_NOT_CHANGED} ${dateInWords(target)} has already passed.`);
    } else {
      try {
        const before = instance.followUpDate;
        await setFollowUpDate(input.instanceId, target, actor.id);
        dateChanged = before !== target;
        dateLines.push(
          `Set the follow-up date to **${dateInWords(target)}**.${
            fields.some((field) => field.semantics === "follow_up_timeframe")
              ? " Next Follow-Up — the timeframe you agreed — is as it was."
              : ""
          }`,
        );
      } catch (error) {
        if (!(error instanceof FollowUpError)) throw error;
        dateLines.push(`${DATE_NOT_CHANGED} ${error.message}`);
      }
    }
  }

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

  /*
   * WHAT THIS TURN MAY TOUCH — decided here, enforced by the merge. See
   * `scopeRevision` for the four kinds of request.
   */
  const findings = followUpKeys && reportsFollowUp ? findingsSupportedBy(input.question) : new Set<string>();
  let scope: RevisionScope = scopeRevision(input.question, labelled, findings);
  if (asksDate) {
    /*
     * The date was the request. Only a field instructed besides it, or the
     * findings of a follow-up reported in the same breath, is still to change
     * — and never Next Follow-Up.
     */
    const keys = new Set([...scope.keys].filter((key) => key !== "next_follow_up"));
    const more = (scope.mode === "fields" || scope.mode === "findings") && keys.size > 0;
    if (!more) return dateReply(dateLines, dateChanged ? input.instanceId : null);
    scope = { ...scope, keys };
  }
  // A report with no edit verb is handled only as the follow-up findings it gives.
  if (!asksRevision && !(reportsFollowUp && followUpKeys)) return null;

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
    scopeInstruction(scope, labelOf),
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

  /* 1. WHAT MAY CHANGE AT ALL: the request's scope, the manager's own text, explicit removals. */
  const plan = planRevision({ question: input.question, fields: labelled, current, proposed, scope });

  /* 2. THE DRAFTING GUARDS, on what is left. The form's own text counts as grounded. */
  const grounding = `${notes}\n${currentText}`;
  const cleaned = stripPlaceholdersFromDraft(plan.values);
  const narrated = guardNarrativeDraft(cleaned.values, fields, grounding);
  const timeframe = guardFollowUpTimeframe(narrated.values, fields, notes);
  /*
   * THE TIMEFRAME NEVER CARRIES A DATE THE MANAGER DID NOT GIVE. "Check back
   * in 10 days" is the agreement; "10/12" in Next Follow-Up is a date the
   * model worked out, and the calendar date has its own control.
   */
  const timeframeValues = withoutInventedDates(timeframe.values, fields, notes, input.today);
  /*
   * A FINDING THE MANAGER STATES IS THEIRS. "Set the progress level to
   * improved" instructs the field and gives the decision, so it is written; a
   * finding the request does not instruct still needs a follow-up in their words.
   */
  const named = scope.mode === "fields" ? scope.keys : new Set<string>();
  const guardedFollowUp = guardManagerFollowUp({ values: timeframeValues, checked: plan.checked }, notes);
  const followUp = {
    values: {
      ...guardedFollowUp.values,
      ...Object.fromEntries(
        Object.entries(timeframeValues).filter(([key]) => named.has(key) && guardedFollowUp.emptied.includes(key)),
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
  /*
   * FINDINGS THE MODEL OFFERED THAT CANNOT GO ON YET — emptied by the guard,
   * or outside the request's scope — while the manager has not described a
   * follow-up. Said, so a blank Progress Level is never a mystery.
   */
  const isFinding = (key: string) => MANAGER_FOLLOW_UP_TEXT_KEYS.has(key) || MANAGER_FOLLOW_UP_GROUP_KEYS.has(key);
  const refusedFindings = [
    ...new Set([
      ...followUp.emptied.filter(isFinding),
      ...(notesDescribeFollowUp(notes) ? [] : plan.untouched.filter(isFinding)),
    ]),
  ];

  if (changed === 0 && plan.cleared.length === 0) {
    const lines = [...dateLines, ...(dateLines.length ? [""] : [])];
    lines.push(
      dateLines.length
        ? `I haven't changed anything else on the ${who}.`
        : `I haven't changed the ${who} — everything on it is as it was.`,
    );
    if (refusedFindings.length > 0) lines.push("", followUpNote(refusedFindings, labelled));
    else lines.push("", "Tell me which part to change and what it should say, and I'll update just that.");
    return dateChanged ? { ...reply(lines.join("\n")), formUpdate: { instanceId: input.instanceId, updated: [FOLLOW_UP_DATE_KEY] } } : reply(lines.join("\n"));
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
    if (dateLines.length) return dateReply(dateLines, dateChanged ? input.instanceId : null);
    return reply(`I haven't changed the ${who} — everything on it is as it was.`);
  }

  const updated = written.filter((key) => !saved.cleared.includes(key)).map(labelOf).filter((label) => label.trim() !== "");
  const lines = [
    ...dateLines,
    ...(dateLines.length ? [""] : []),
    `Updated the ${who}${updated.length ? `: ${updated.join(", ")}` : ""}.${saved.cleared.length ? ` Removed ${saved.cleared.map(labelOf).join(", ")}.` : ""} Everything else on the form is as it was.`,
  ];
  if (refusedFindings.length > 0) lines.push("", followUpNote(refusedFindings, labelled));
  if (sensitive.anyRefused) {
    lines.push("", "I didn't tick a termination, demotion or suspension — that decision stays with leadership.");
  }
  lines.push("", "Give it a read below before you finalize.");

  return {
    ...reply(lines.join("\n")),
    formUpdate: { instanceId: input.instanceId, updated: dateChanged ? [...written, FOLLOW_UP_DATE_KEY] : written },
  };
}

/** Every field, group and option label on the form, lower-cased. */
function formVocabulary(document: ReturnType<typeof parseFormDocument>, variantKey: string | null): Set<string> {
  const words = new Set<string>();
  for (const field of draftableFields(document, variantKey)) words.add(interpolate(field.label, null).toLowerCase());
  for (const group of draftableCheckboxGroups(document, variantKey)) {
    if (group.label) words.add(group.label.toLowerCase());
    for (const option of group.options) words.add(option.label.toLowerCase());
  }
  for (const label of Object.values(GROUP_LABELS)) words.add(label.toLowerCase());
  return words;
}

/** Not a field: the instance's own follow-up date, named in `formUpdate.updated`. */
const FOLLOW_UP_DATE_KEY = "follow_up_date";

const DATE_NOT_CHANGED = "I didn't change the follow-up date. Use the Follow-up date control on the form.";

function dateReply(lines: readonly string[], changedInstanceId: string | null): AskResponse {
  const content = [...lines, "", "Nothing else on the form was changed."].join("\n");
  return changedInstanceId
    ? { ...reply(content), formUpdate: { instanceId: changedInstanceId, updated: [FOLLOW_UP_DATE_KEY] } }
    : reply(content);
}

function dateInWords(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function humanize(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What the model is told it may touch. The merge enforces the same thing. */
function scopeInstruction(scope: RevisionScope, labelOf: (key: string) => string): string {
  const names = [...scope.keys].map(labelOf).join(", ");
  const kept = scope.protectedKeys.size
    ? ` The manager asked you to keep ${[...scope.protectedKeys].map(labelOf).join(", ")} exactly as it is.`
    : "";
  switch (scope.mode) {
    case "fields":
      return `THIS REQUEST CHANGES ONLY: ${names}. Return no other field.${kept}`;
    case "findings":
      return `THE MANAGER IS REPORTING WHAT THEY FOUND AT THE FOLLOW-UP. From their words only, write: ${names}. Return no other field. A progress level or next step is only what the manager said.${kept}`;
    case "additive":
      return `ADD THE NEW INFORMATION to the text field it belongs in, keeping everything that field already says. Do not change any checkbox, and do not touch fields the new information is not about.${kept}`;
    case "wording":
      return `IMPROVE THE WORDING ONLY. Reword text that is already on the form, keeping every fact. Do not fill an empty field, do not empty a field, and do not change any checkbox.${kept}`;
  }
}

/** Drops a timeframe value carrying a calendar date the manager never gave. */
function withoutInventedDates(
  values: Record<string, string>,
  fields: readonly { key: string; semantics?: string }[],
  notes: string,
  today: string | undefined,
): Record<string, string> {
  if (!today) return values;
  const given = new Set(datesInText(notes, today).map((found) => found.iso));
  const timeframeKeys = new Set(fields.filter((field) => field.semantics === "follow_up_timeframe").map((field) => field.key));
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => !timeframeKeys.has(key) || datesInText(value, today).every((found) => given.has(found.iso)),
    ),
  );
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
