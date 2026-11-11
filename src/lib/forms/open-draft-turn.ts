import type { AskResponse } from "@/lib/ai/types";
import { isQuestionNotForm } from "@/lib/ai/question-not-form";
import {
  formEditSingleWriterEnabled,
  openDraftKeepsTurnsEnabled,
  pastedOutlineToOpenDraftEnabled,
  pastedTemplateFieldsToOpenDraftEnabled,
  templateOutlineFieldsEnabled,
} from "@/lib/config/chat-quality-flags";
import { extractEmployeeNames, samePerson } from "@/lib/forms/proposal";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * WITH A DRAFT OPEN, A TURN ABOUT IT GOES TO IT — NEVER TO A NEW CARD
 * ============================================================================
 *
 * OPEN_DRAFT_KEEPS_TURNS_ENABLED. The 2 Nov 2026 scan (QA, 3 Nov): "Details
 * managers had typed were lost … her next message started a new draft without
 * what she'd typed, and that generic version is the one that got finalized."
 * A Salon Director created a verbal Corrective Action draft, typed on it, and
 * 42 minutes later said "underperformance for the month of october". No path
 * read that as an edit of the open draft, so the intake offered a new card for
 * the same person; its Create made a second draft, without her words, and
 * that one was finalized.
 *
 * Last of the open-form paths (after the correction, policy, redraft, copy
 * and revision readers): with a DRAFT open, a turn that names no form, no
 * other person, and is not a question, is content for that draft — revised in
 * the manager's words. If the revision writes nothing, the reply says so;
 * either way no new card is offered for a form already open.
 */
export async function openDraftTurn(input: {
  request: Request;
  instanceId: string;
  question: string;
  history: readonly ChatMessage[];
  today: string;
}): Promise<AskResponse | null> {
  if (!openDraftKeepsTurnsEnabled()) return null;
  const question = input.question.trim();
  /*
   * PASTED_OUTLINE_TO_OPEN_DRAFT_ENABLED (QA's Sunny round-23 live test of sf-s21, conv_mwb21a4z2rxf5y1): with <A>'s
   * Corrective Action draft open, the manager pasted <B>'s CA as a template ("Observation of Offense: … <B> completed
   * 237 tanning transactions … Action Plan: The Leadership Team will coach <B> …"). It names <B>, so it was read as a
   * new request ("Is this for <B>?") and a new card covered the draft; the outline never reached it. A pasted turn
   * with two or more of the open form's own field labels as headings is that draft's outline, with its own facts.
   */
  const pasted = pastedOutlineToOpenDraftEnabled() && question ? await pastedOutline({ ...input, question }) : null;
  if (!pasted) {
    if (!question || /\?\s*$/.test(question) || isQuestionNotForm(question, input.history)) return null;
    if (detectTemplateIntent(question).kind !== "none") return null;
  }
  const open = await (await import("@/lib/forms/open-form-summary")).describeOpenForm(input.request, input.instanceId);
  if (!open || open.status !== "draft") return null;
  if (!pasted && extractEmployeeNames(question).some((name) => !samePerson(name, open.employeeName))) return null;
  /*
   * FORM_EDIT_SINGLE_WRITER_ENABLED: the draft before the turn, and the
   * revision's claim checked against what was saved (`lib/forms/form-write.ts`).
   * The write itself is the revision's (`chat-revision.ts`, protected) until
   * 2b routes it through `writeRevisionEdits`.
   */
  const before = formEditSingleWriterEnabled()
    ? await (await import("@/lib/forms/form-write")).editSnapshot(input.instanceId, "open_draft")
    : null;
  const revised = await (await import("@/lib/forms/chat-revision")).reviseActiveForm({
    request: input.request,
    instanceId: input.instanceId,
    // TEMPLATE_OUTLINE_FIELDS_ENABLED (Pau's sf-s21): "the same out line" as a pasted template names the template's fields.
    question: pasted ?? (templateOutlineFieldsEnabled() ? await outlineQuestion(input) : null) ?? `Add this to the ${open.templateName}: ${question}`,
    history: [...input.history],
    today: input.today,
  });
  if (revised && formEditSingleWriterEnabled() && before) {
    return (await import("@/lib/forms/form-write")).realizedClaim(revised, input.instanceId, before);
  }
  if (revised) return revised;
  /*
   * PASTED_TEMPLATE_FIELDS_TO_OPEN_DRAFT_ENABLED (QA's Sunny round-25 live test of sf-s21, 11 Nov 2026): the pasted
   * template reached the open draft, but the revision wrote nothing ("Nothing on the form has changed yet. I couldn't
   * place that …"). Its labelled sections go into the draft's fields of those labels, in the draft's employee's name.
   */
  if (pasted && pastedTemplateFieldsToOpenDraftEnabled()) {
    const placed = await placePastedTemplate({ ...input, question, employeeName: open.employeeName });
    if (placed) return placed;
  }
  return {
    content: [
      `**Nothing on the form has changed yet.** I couldn't place that on the open ${open.templateName} for ${open.employeeName}.`,
      "Tell me which part it belongs in — for example \"add to the observation: …\" — or type it on the card and press **Save changes**. The draft you have open is the one I'll change; I won't start another.",
    ].join("\n\n"),
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
  };
}

/** TEMPLATE_OUTLINE_FIELDS_ENABLED: the request naming a pasted template's fields, or null (`lib/forms/template-outline.ts`). */
async function outlineQuestion(input: { request: Request; instanceId: string; question: string; history: readonly ChatMessage[] }): Promise<string | null> {
  const outline = await import("./template-outline");
  if (!outline.asksForOutline(input.question)) return null;
  const loaded = await (await import("./instance-scope"))
    .authorizeInstance(input.request, input.instanceId, "view")
    .then((authorized) => authorized.loaded)
    .catch(() => null);
  if (!loaded) return null;
  const { fieldsForVariant, interpolate, parseFormDocument } = await import("./document");
  const fields = fieldsForVariant(parseFormDocument(loaded.version.document), loaded.instance.variantKey).map((field) => ({
    key: field.key,
    label: interpolate(field.label, null),
  }));
  const named = outline.withTemplateFieldsNamed({ question: input.question.trim(), history: input.history, fields });
  return named === input.question.trim() ? null : named;
}

/** The open form's fields, with their labels as printed. */
async function openFormFields(input: { request: Request; instanceId: string }): Promise<{ key: string; label: string }[] | null> {
  const loaded = await (await import("./instance-scope"))
    .authorizeInstance(input.request, input.instanceId, "view")
    .then((authorized) => authorized.loaded)
    .catch(() => null);
  if (!loaded) return null;
  const { fieldsForVariant, interpolate, parseFormDocument } = await import("./document");
  return fieldsForVariant(parseFormDocument(loaded.version.document), loaded.instance.variantKey).map((field) => ({
    key: field.key,
    label: interpolate(field.label, null),
  }));
}

/**
 * PASTED_OUTLINE_TO_OPEN_DRAFT_ENABLED: a turn that IS a pasted outline of the open form — two or more of its field
 * labels as headings — read as the request to rewrite those fields in that outline with the draft's own facts
 * (`template-outline.ts` withTemplateFieldsNamed). Null for any other turn.
 */
async function pastedOutline(input: { request: Request; instanceId: string; question: string; history: readonly ChatMessage[] }): Promise<string | null> {
  const outline = await import("./template-outline");
  const fields = await openFormFields(input);
  if (!fields || outline.headedFields(input.question, fields).length < 2) return null;
  const asked = `${input.question}\n\nThe same outline, with this form's own facts.`;
  const named = outline.withTemplateFieldsNamed({ question: asked, history: input.history, fields });
  return named === asked ? null : named;
}

/**
 * PASTED_TEMPLATE_FIELDS_TO_OPEN_DRAFT_ENABLED: the pasted template's labelled sections written onto the open draft
 * (`lib/forms/pasted-template-fields.ts`) as the manager's own words, through the one writer when it is on. Null when
 * nothing could be placed, so the caller says so.
 */
async function placePastedTemplate(input: {
  request: Request;
  instanceId: string;
  question: string;
  employeeName: string;
  today: string;
}): Promise<AskResponse | null> {
  const authorized = await (await import("./instance-scope"))
    .authorizeInstance(input.request, input.instanceId, "edit")
    .catch(() => null);
  if (!authorized) return null;
  const { fieldsForVariant, interpolate, parseFormDocument } = await import("./document");
  const fields = fieldsForVariant(parseFormDocument(authorized.loaded.version.document), authorized.loaded.instance.variantKey).map((field) => ({
    key: field.key,
    label: interpolate(field.label, null),
  }));
  const values = (await import("./pasted-template-fields")).pastedTemplateValues({
    text: input.question,
    fields,
    employeeName: input.employeeName,
  });
  if (Object.keys(values).length === 0) return null;
  let written: string[];
  if (formEditSingleWriterEnabled()) {
    const { opsFrom, writeFormEdits } = await import("./form-write");
    const result = await writeFormEdits(input.instanceId, opsFrom({ values }, { by: "manager" }), {
      path: "open_draft",
      actorId: authorized.actor.id,
      latest: input.question,
      today: input.today,
    });
    written = result.changed.map((change) => change.key);
  } else {
    await (await import("./instances")).saveInstanceValues(input.instanceId, { values, checked: {} }, authorized.actor.id);
    written = Object.keys(values);
  }
  if (written.length === 0) return null;
  const labels = fields.filter((field) => written.includes(field.key)).map((field) => `**${field.label}**`);
  return {
    content: [
      `Placed your pasted outline on the open form for ${input.employeeName}: ${labels.join(" and ")}, in ${input.employeeName}'s name.`,
      "The rest of the template's wording is as you pasted it — check its numbers and dates are this employee's before you finalize.",
    ].join("\n\n"),
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
    formUpdate: { instanceId: input.instanceId, updated: written },
  };
}
