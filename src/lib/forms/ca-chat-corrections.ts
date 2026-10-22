import "server-only";

import type { AskResponse } from "@/lib/ai/types";

import { caDateQuestion, readCaDateEdit, rewriteDate, type CaDateEdit } from "./ca-chat-dates";
import { checkboxGroupsForVariant, displayDate, fieldsForVariant, parseFormDocument } from "./document";
import { changeOnEditableDraft } from "./editable-draft";
import { authorizeInstance } from "./instance-scope";
import { confirmWarningLevel, recordChatCorrection, saveInstanceValues } from "./instances";
import { warningLevelConfirmed } from "./warning-level-gate";
import { extractEmployeeNames, samePerson } from "./proposal";
import { correctedDates, priorSteps } from "./form-date-answer";
import { enforcePersonEdit } from "./responsibility";
import { detectTemplateIntent } from "./template-intent";
import { readWarningConfirmation } from "./warning-confirmation";

/**
 * ============================================================================
 * CORRECTIONS TO AN OPEN CORRECTIVE ACTION DRAFT, FROM THE CHAT
 * ============================================================================
 *
 * Owner decisions, 22 Oct 2026, for an editable Corrective Action draft open
 * in the conversation:
 *
 *   DATES        the form's Date line, the incident's date and a prior
 *                action's date may each be corrected; which one is read by
 *                `readCaDateEdit`, and a date with no field is asked about.
 *   THE LEVEL    a suggested Type of Warning is confirmed, or another chosen,
 *                with "confirm the written warning" (`readWarningConfirmation`).
 *
 * Tried by `correctActiveForm` before its own readers. Null for anything else,
 * so every other turn is answered as before. Every change is the manager's own
 * edit — so a later redraft keeps it — and is recorded field by field. Only
 * the fields the correction names change. A finalized form is changed on a new
 * draft of it, never in place.
 */
export async function correctCaFromChat(input: {
  request: Request;
  instanceId: string;
  question: string;
  today: string;
  lastAssistant?: string;
  /**
   * The level this turn states for the form, read by the app's own warning
   * reader where its other correction paths would save it as the assistant's
   * ("make it a verbal instead"). A stated level is the manager's selection.
   */
  statedLevel?: "verbal" | "written" | null;
}): Promise<AskResponse | null> {
  const question = (input.question ?? "").trim();
  // A turn about prior actions or their dates ("the verbal ca was 9-2-26, not 9-1-26") never sets this form's level.
  const aboutHistory = priorSteps(question, input.today).length > 0 || correctedDates(question, input.today).size > 0;
  const confirmation = readWarningConfirmation(question) ?? (input.statedLevel && !aboutHistory ? { level: input.statedLevel } : null);
  if (!confirmation && !mayCorrectDates(question)) return null;

  // A request for another form is not a correction to this one.
  const intent = detectTemplateIntent(question);
  if (intent.kind === "ambiguous") return null;
  if (
    (intent.kind === "explicit" || intent.kind === "corrective_action") &&
    /\b(?:create|make\s+(?:a|an)|start|pull\s+up|new|another|need\s+(?:a|an))\b/i.test(question)
  ) {
    return null;
  }

  let authorized: Awaited<ReturnType<typeof authorizeInstance>>;
  try {
    authorized = await authorizeInstance(input.request, input.instanceId, "edit");
  } catch {
    return null;
  }
  const { actor, loaded } = authorized;
  const instance = loaded.instance;
  const document = parseFormDocument(loaded.version.document);
  const fields = fieldsForVariant(document, instance.variantKey);
  const has = (key: string) => fields.some((field) => field.key === key);
  // The Corrective Action Form's shape: a Date line, an account, a history line and a Type of Warning.
  const warningGroup = checkboxGroupsForVariant(document, instance.variantKey).find((group) => group.key === "warning_type");
  if (!has("form_date") || !has("observation") || !has("prior_actions") || !warningGroup) return null;

  const named = extractEmployeeNames(question);
  if (named.length > 0 && !named.some((name) => samePerson(name, instance.employeeName))) return null;

  const who = `**${instance.templateName}** for **${instance.employeeName}**`;
  const onDraft = () =>
    changeOnEditableDraft(input.request, input.instanceId, (draftId) => correctCaFromChat({ ...input, instanceId: draftId }));

  /* ------------------------------------------------ the level, confirmed -- */
  if (confirmation) {
    const row = loaded.values.find((entry) => entry.fieldKey === "warning_type");
    const current = (row?.checked ?? []).filter((key) => key === "verbal" || key === "written");
    const level = confirmation.level ?? (current.length === 1 ? current[0]! : null);
    const label = (key: string) => warningGroup.options.find((option) => option.key === key)?.label ?? key;
    if (!level || !warningGroup.options.some((option) => option.key === level)) {
      return reply(`There's no single Type of Warning on the ${who} to confirm yet. Tell me Verbal or Written and I'll set it as your decision.`);
    }
    if (warningLevelConfirmed(row) && current.length === 1 && current[0] === level) {
      return reply(`**${label(level)}** is already confirmed as your decision on the ${who}. Nothing needed changing.`);
    }
    if (instance.status !== "draft") return onDraft();
    await confirmWarningLevel(input.instanceId, actor.id, level);
    const suggested = row?.filledBy === "ai" ? current : [];
    const changed = current.length !== 1 || current[0] !== level;
    const was = suggested.length === 1 && suggested[0] !== level ? ` — it had suggested ${label(suggested[0]!)}` : "";
    return {
      ...reply(
        changed
          ? `Type of Warning → **${label(level)}** on the ${who}, as your decision${was}. Everything else on the form is as it was.`
          : `Confirmed **${label(level)}** as your decision on the ${who}. Everything else on the form is as it was.`,
      ),
      formUpdate: { instanceId: input.instanceId, updated: ["warning_type"] },
    };
  }

  /* ------------------------------------------------------------ the dates -- */
  const value = (key: string) => loaded.values.find((entry) => entry.fieldKey === key)?.value ?? "";
  const form = { formDate: value("form_date") || instance.formDate || null, observation: value("observation"), priorActions: value("prior_actions") };
  const edit: CaDateEdit | null = readCaDateEdit({ text: question, today: input.today, form, lastAssistant: input.lastAssistant });
  if (!edit) return null;
  if (edit.kind === "ask") return reply(caDateQuestion(edit.to, form));
  if (instance.status !== "draft") return onDraft();

  const shown = (iso: string | null) => (iso ? displayDate(iso, { ...document.style, dateFormat: "us" }) : "blank");
  const values: Record<string, string> = {};
  const changes: { field: string; from: string | null; to: string }[] = [];
  const notes: string[] = [];
  if (edit.kind === "form") {
    if (form.formDate === edit.to) return reply(`The ${who} is already dated ${shown(edit.to)}. Nothing needed changing.`);
    values.form_date = edit.to;
    changes.push({ field: "form_date", from: form.formDate, to: edit.to });
  } else if (edit.kind === "incident") {
    if (form.formDate && (form.formDate === edit.from || !edit.from) && form.formDate !== edit.to) {
      values.form_date = edit.to;
      changes.push({ field: "form_date", from: form.formDate, to: edit.to });
    }
    const observationRow = loaded.values.find((entry) => entry.fieldKey === "observation");
    // The drafted account stays the assistant's wording after a date fixed here from the chat.
    const lastFixed = [...loaded.events]
      .reverse()
      .flatMap((event) => (event.detail.via === "chat_correction" && Array.isArray(event.detail.changes) ? event.detail.changes : []))
      .find((change: { field?: string }) => change.field === "observation") as { to?: string } | undefined;
    const drafted = observationRow?.filledBy === "ai" || (lastFixed !== undefined && lastFixed.to === form.observation);
    if (edit.from && edit.from !== edit.to && form.observation.trim() !== "") {
      const rewritten = rewriteDate(form.observation, edit.from, edit.to, input.today);
      // Only an account the assistant drafted is rewritten; the manager's own wording is theirs.
      if (rewritten.replaced > 0 && drafted) {
        values.observation = rewritten.text;
        changes.push({ field: "observation", from: form.observation, to: rewritten.text });
      } else if (rewritten.replaced > 0) {
        notes.push(`The account you wrote still says ${shown(edit.from)}; I haven't changed your wording — edit it on the form if it should say ${shown(edit.to)}.`);
      }
    }
    if (changes.length === 0 && notes.length === 0) {
      return reply(`The ${who} already has ${shown(edit.to)} as the incident date. Nothing needed changing.`);
    }
    if (changes.length === 0) return reply(notes.join("\n\n"));
  } else {
    if (edit.changes.length === 0) return reply(`Those are already on the ${who}'s prior actions. Nothing needed changing.`);
    values.prior_actions = edit.value;
    for (const change of edit.changes) changes.push({ field: "prior_actions", from: change.from, to: change.to });
  }

  const accepted = enforcePersonEdit(document, instance.variantKey, { values, checked: {} });
  const keys = Object.keys(accepted.values);
  if (keys.length === 0) return null;
  const saved = await saveInstanceValues(input.instanceId, { values: accepted.values, checked: {} }, actor.id);
  const refused = new Set(saved.rejected.map((entry) => entry.key));
  const written = keys.filter((key) => !refused.has(key));
  if (written.length === 0) return null;
  await recordChatCorrection(input.instanceId, actor.id, changes.filter((change) => written.includes(change.field)));

  const label = (key: string) => fields.find((field) => field.key === key)?.label ?? key;
  const described: string[] = [];
  if (written.includes("form_date")) described.push(`${label("form_date")} → ${shown(values.form_date!)}`);
  if (written.includes("observation") && edit.kind === "incident") {
    described.push(`${label("observation")}: ${shown(edit.from)} → ${shown(edit.to)}`);
  }
  if (written.includes("prior_actions") && edit.kind === "prior") {
    for (const change of edit.changes) described.push(change.from ? `${change.from} → ${change.to}` : `added "${change.to}"`);
  }
  return {
    ...reply([`Updated the ${who}: ${described.join("; ")}. Everything else on the form is as it was.`, ...notes].join("\n\n")),
    formUpdate: { instanceId: input.instanceId, updated: written },
  };
}

/** A cheap first reading, before anything is loaded: a date, or a prior step. */
function mayCorrectDates(question: string): boolean {
  return /\d|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|\b(?:incident|form|which|both|date)\b/i.test(question);
}

function reply(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}
