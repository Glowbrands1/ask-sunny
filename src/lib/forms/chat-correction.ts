import "server-only";

import type { AskResponse } from "@/lib/ai/types";

import {
  answerStatementText,
  blocksForVariant,
  checkboxGroupsForVariant,
  displayDate,
  fieldsForVariant,
  parseFormDocument,
  responsibilityMap,
  type FormDocument,
} from "./document";
import { CORRECTABLE_KEYS, correctionValues, employmentChangeKind, syncNarrative } from "./employment-change";
import { changeOnEditableDraft } from "./editable-draft";
import { EXIT_CORRECTABLE_KEYS, exitCorrectionValues } from "./exit-details";
import { isExitDocumentKeys } from "./exit-draft";
import { authorizeInstance } from "./instance-scope";
import { syncCorrectiveActionPlan } from "./ca-action-plan-sync";
import { PAYROLL_DEDUCT_KEY, payrollDeductChecked, payrollDeductCorrection, payrollDeductReply } from "./payroll-deduct";
import { extractEmployeeNames } from "./proposal";
import { describesIncident, statedWarningLevel, WARNING_TYPE_KEY } from "./corrective-action-intake";
import { extractFormDate, priorSteps } from "./form-date-answer";
import { NO_PRIOR_ACTION, statedPriorActions } from "./prior-actions";
import { detectTemplateIntent } from "./template-intent";
import { saveInstanceValues } from "./instances";
import { enforcePersonEdit } from "./responsibility";

/**
 * ============================================================================
 * CORRECTING A FORM THAT ALREADY EXISTS, FROM THE CONVERSATION
 * ============================================================================
 *
 * "Change her new location to salon 24", typed after the Demotion or Position
 * Transfer Form was created in this conversation, updates that form rather
 * than starting the interview again. So does "actually she did return her
 * key" or "her last day was 9/16" on the Resignation/Exit Form — read with
 * the exit form's own readers (`exitCorrectionValues`), so the same words
 * that filled the draft are what correct it.
 *
 * EVERYTHING IS RE-CHECKED. The browser names the instance; this loads it and
 * runs `authorizeInstance` with the "edit" action, which applies the TEMPLATE'S
 * own permission and the salon scope exactly as the inline editor's save does.
 * An id that fails, or that is not an employment change form, returns null and
 * the turn is answered as it always would have been.
 *
 * IT IS THE MANAGER'S OWN EDIT. Saved through `saveInstanceValues` — the same
 * path as typing into the field — so it is recorded as the manager's and
 * limited to fields a person may edit. A finalized form is never written: the
 * correction is made on a new draft of it (`editable-draft.ts`).
 */
export async function correctActiveForm(input: {
  request: Request;
  instanceId: string;
  question: string;
  today: string;
  /**
   * The conversation so far — read only for the last assistant turn, so a
   * bare "no" that answers Ask Sunny's own payroll question is read as that
   * answer rather than asked for again.
   */
  history?: readonly { role: string; content: string; error?: unknown }[];
}): Promise<AskResponse | null> {
  // A cheap first reading, before anything is loaded: most turns are not corrections.
  const employmentCorrection = correctionValues(input.question, input.today);
  const exitCorrection = exitCorrectionValues(input.question, input.today);
  const lastAssistant =
    [...(input.history ?? [])].reverse().find((turn) => turn.role === "assistant" && !turn.error)?.content ?? "";
  const payroll = payrollDeductCorrection(input.question) ?? payrollDeductReply(input.question, lastAssistant);
  if (!employmentCorrection && !exitCorrection && !payroll) return correctCorrectiveActionFacts(input);

  let authorized: Awaited<ReturnType<typeof authorizeInstance>>;
  try {
    authorized = await authorizeInstance(input.request, input.instanceId, "edit");
  } catch {
    // Not visible, not permitted, or gone: the turn goes on as a normal one.
    return null;
  }
  const { actor, loaded } = authorized;
  const document = parseFormDocument(loaded.version.document);
  const variantKey = loaded.instance.variantKey;
  const kind = employmentChangeKind(loaded.instance.templateKey);
  /*
   * "NO PAYROLL DEDUCTION" / "CHANGE PAYROLL DEDUCT TO YES" on a form whose
   * version asks "Is payroll deduct applicable?" — today the Corrective Action
   * Form. That one answer is the only thing such a form takes from chat; its
   * other lines are edited on the form. Read off the version's keys, so no
   * template key is special-cased.
   */
  const asksPayroll = checkboxGroupsForVariant(document, variantKey).some(
    (group) => group.key === PAYROLL_DEDUCT_KEY,
  );
  // The Exit Form, read off the pinned version's keys as the drafting route does.
  const isExit = !kind && isExitDocumentKeys(responsibilityMap(document, variantKey).keys());
  if (!kind && !isExit && !(asksPayroll && payroll)) return null;
  /*
   * ==========================================================================
   * A NEW REQUEST IS NEVER A CORRECTION TO THE LAST FORM
   * ==========================================================================
   *
   * Found in hands-on QA: with a Demotion Form for one employee open, "pull
   * up a transfer form for jane doe, … from stc 12 to salon 18" was read as a
   * correction and wrote Jane's details onto the other employee's demotion.
   * So a turn that asks for a form (any other than this one), or that names a
   * person who is not this form's employee, is left to the ordinary flow —
   * which proposes the new form.
   */
  const intent = detectTemplateIntent(input.question);
  if (
    intent.kind === "ambiguous" ||
    intent.kind === "corrective_action" ||
    (intent.kind === "explicit" && intent.templateKey !== loaded.instance.templateKey) ||
    (intent.kind === "explicit" && /\b(?:create|make|start|pull up|new|another|need)\b/i.test(input.question))
  ) {
    return null;
  }
  // "change the name to …" is the one correction that names somebody new, on purpose.
  const renaming = /\b(?:change|update|correct|fix|set|make)\s+(?:the\s+|her\s+|his\s+|their\s+)?(?:employee(?:'s)?\s+)?name\b/i.test(input.question);
  const named = renaming ? [] : extractEmployeeNames(input.question);
  if (named.length > 0 && !named.some((name) => samePerson(name, loaded.instance.employeeName))) {
    return null;
  }

  /*
   * THE EXIT FORM'S CORRECTION is its own readers' reading, plus the one
   * header line a correction may name on purpose — the employee's name.
   */
  const exitValues =
    exitCorrection || employmentCorrection?.values.employee_name
      ? {
          values: {
            ...(exitCorrection?.values ?? {}),
            ...(employmentCorrection?.values.employee_name
              ? { employee_name: employmentCorrection.values.employee_name }
              : {}),
          },
          checked: exitCorrection?.checked ?? {},
        }
      : null;
  const correction = kind
    ? employmentCorrection
    : isExit
      ? exitValues
      : { values: {}, checked: payrollDeductChecked(payroll) };
  if (!correction) return null;

  const who = `**${loaded.instance.templateName}** for **${loaded.instance.employeeName}**`;
  /*
   * A FINALIZED FORM IS CORRECTED ON A NEW DRAFT OF IT — opened here, with
   * the same correction then applied to that draft. The signed record itself
   * is never written. See `editable-draft.ts`.
   */
  if (loaded.instance.status !== "draft") {
    return changeOnEditableDraft(input.request, input.instanceId, (draftId) =>
      correctActiveForm({ ...input, instanceId: draftId }),
    );
  }

  const correctable: ReadonlySet<string> = kind
    ? CORRECTABLE_KEYS
    : isExit
      ? EXIT_CORRECTABLE_KEYS
      : new Set([PAYROLL_DEDUCT_KEY]);
  const restrict = <T,>(entries: Record<string, T>) =>
    Object.fromEntries(Object.entries(entries).filter(([key]) => correctable.has(key)));
  const values = restrict(correction.values);
  const checked = restrict(correction.checked);

  // Only keys this version actually has; the rest are not a correction to THIS form.
  const present = new Set([
    ...fieldsForVariant(document, variantKey).map((field) => field.key),
    ...checkboxGroupsForVariant(document, variantKey).map((group) => group.key),
  ]);
  const onForm = <T,>(entries: Record<string, T>) =>
    Object.fromEntries(Object.entries(entries).filter(([key]) => present.has(key)));
  const submitted = { values: onForm(values), checked: onForm(checked) };
  const keys = [...Object.keys(submitted.values), ...Object.keys(submitted.checked)];
  if (keys.length === 0) return null;

  /*
   * WHAT THE PERSON MAY WRITE, decided before anything is saved — the same
   * `enforcePersonEdit` the save applies — so the paragraph below is only
   * ever brought in line with a value that is actually going to be written.
   */
  const accepted = enforcePersonEdit(document, variantKey, submitted);
  const refused = new Set(accepted.rejected.map((entry) => entry.key));
  const updated = keys.filter((key) => !refused.has(key));
  if (updated.length === 0) return null;

  const reason =
    kind || isExit
      ? loaded.values.find((row) => row.fieldKey === "reason" || row.fieldKey === "details")
      : undefined;
  // The exit form's paragraph is printed as "Additional Details" from revision 2.
  const paragraph =
    reason?.fieldKey === "details"
      ? `${fieldsForVariant(document, variantKey).find((field) => field.key === "details")?.label ?? "Details"} paragraph`
      : "reason paragraph";

  /*
   * THE PARAGRAPH FOLLOWS THE FIELD — on the Demotion and Position Transfer
   * Forms. A value the correction replaced is also replaced where the reason
   * paragraph names it, so the form never says "Salon 24" in one place and
   * "salon 23" in another. See `syncNarrative`, which rewrites only what it
   * can prove is that value and reports the rest. The Exit Form's Details
   * paragraph is not rewritten here; it keeps its reminder below.
   */
  const narrative = reason?.value ?? "";
  let sync: ReturnType<typeof syncNarrative> | null = null;
  if (kind && reason && narrative.trim() !== "") {
    const previous = new Map(loaded.values.map((row) => [row.fieldKey, row.value ?? ""]));
    const changedText = updated.filter((key) => key in submitted.values);
    sync = syncNarrative({
      narrative,
      changes: changedText.map((key) => ({ from: previous.get(key) ?? "", to: submitted.values[key]! })),
      unchanged: loaded.values
        .filter((row) => row.fieldKey !== reason.fieldKey && !changedText.includes(row.fieldKey))
        .map((row) => row.value ?? "")
        .filter((value) => value.trim() !== ""),
    });
  }
  /*
   * ONLY A PARAGRAPH ASK SUNNY DRAFTED IS REWRITTEN. Found in QA: a reason the
   * manager wrote themselves ("she asked to move to salon 23 because salon 23
   * is closer to home") became "…because Salon 24 is closer to home" — the
   * manager's own account, changed. A paragraph a person wrote or edited is
   * never rewritten; what would have changed is reported for them instead.
   */
  const drafted = reason?.filledBy === "ai";
  if (sync && !drafted) {
    sync = {
      text: narrative,
      replaced: [],
      left: [...new Set([...sync.left, ...sync.replaced.map((change) => change.from)])],
    };
  }
  const syncedKey = reason && sync && sync.text !== narrative ? reason.fieldKey : null;

  /*
   * ONE SAVE. The corrected field and the paragraph that names it are written
   * together, in the single upsert `saveInstanceValues` makes, so a failure
   * leaves neither: the form can never hold "Salon 24" beside a reason that
   * still says "salon 23" because a second write failed after the first.
   */
  const toSave = {
    values: { ...accepted.values, ...(syncedKey ? { [syncedKey]: sync!.text } : {}) },
    checked: accepted.checked,
  };
  const saved = await saveInstanceValues(input.instanceId, toSave, actor.id);
  // The reply reports only what the save itself accepted.
  const refusedOnSave = new Set(saved.rejected.map((entry) => entry.key));
  const written = updated.filter((key) => !refusedOnSave.has(key));
  if (written.length === 0) return null;
  const rewritten = syncedKey && !refusedOnSave.has(syncedKey) ? syncedKey : null;
  /*
   * THE ACTION PLAN STATES THE DEDUCTION ONLY ON YES, so a corrected payroll
   * answer rebuilds a plan Ask Sunny built (never one a person wrote). The
   * amount is read from this message, else kept from the plan. See
   * `ca-action-plan.ts`.
   */
  const planKeys = written.includes(PAYROLL_DEDUCT_KEY)
    ? await syncCorrectiveActionPlan(input.instanceId, actor.id, {
        notes: input.question,
        loaded,
        checked: accepted.checked,
      })
    : [];

  const before = Object.fromEntries(loaded.values.map((row) => [row.fieldKey, row.checked]));
  const after = { ...before, ...submitted.checked };
  const described = written
    .map((key) => describe(document, variantKey, key, submitted, { before, after }))
    .filter((line): line is string => line !== null);
  const lines = [
    `Updated the ${who}: ${described.length > 0 ? described.join("; ") : "Resignation Details boxes cleared"}.`,
  ];
  if (rewritten) {
    written.push(rewritten);
    const changes = sync!.replaced.map((change) => `"${change.from}" → "${change.to}"`).join(", ");
    lines.push("", `I changed ${changes} in the ${paragraph} too, so it matches the form.`);
  }
  if (sync && sync.left.length > 0) {
    const values = sync.left.map((value) => `"${value}"`).join(", ");
    lines.push(
      "",
      `The ${paragraph} still mentions ${values}, which I didn't change automatically because I can't be sure that mention means this line — check that it still says what you mean.`,
    );
  } else if (reason && narrative.trim() !== "" && !rewritten) {
    lines.push("", `The ${paragraph} was written before this change — give it a quick read to make sure it still matches.`);
  }
  if (planKeys.length > 0) {
    written.push(...planKeys);
    lines.push(
      "",
      payroll === "yes" ? "The Action Plan now states the payroll deduction." : "The Action Plan no longer states a payroll deduction.",
    );
  }

  return { ...reply(lines.join("\n")), formUpdate: { instanceId: input.instanceId, updated: written } };
}

/** "jane", "Jane Doe" and "JANE DOE" name the employee on a form for "Jane Doe". */
function samePerson(named: string, employee: string): boolean {
  const a = named.toLowerCase().replace(/['’]s$/, "").split(/\s+/);
  const b = employee.toLowerCase().split(/\s+/);
  return a.join(" ") === b.join(" ") || (a.length === 1 && a[0] === b[0]);
}

/*
 * ============================================================================
 * THE OPEN CORRECTIVE ACTION FORM, TOLD ONE MORE OF ITS FACTS
 * ============================================================================
 *
 * QA, 22 Oct 2026. With the form already created, "prior coaching JBA Policy
 * Manual 7-29-26", "she also had a verbal ca on 9-1-26", "first time, no prior
 * coaching", "it happened on 10/19/26" and "make it a written" changed nothing
 * on the form. Each is a fact this form records, stated on its own, and it now
 * goes onto the open draft:
 *
 *   an earlier step and its date   added to Prior Actions, as the drafting
 *                                  route writes it — never a line already
 *                                  there, and nothing on the list removed
 *   "first time", "no prior …"     "None — first occurrence", only where
 *                                  Prior Actions is empty
 *   the date of what happened      the form's date — never an earlier step's
 *                                  date, never a future one, and not where the
 *                                  turn tells a new incident
 *   the level for this form        Type of Warning — never a level on file,
 *                                  and a Termination or Demotion tick stays
 *
 * Read only from the manager's statement; a question is answered as before.
 */
const NO_HISTORY =
  /\b(?:first\s+(?:time|offen[cs]e|occurrence|one)|no\s+(?:prior|previous|past|earlier)\b|no\s+(?:coaching|warnings?|write[- ]?ups?|corrective\s+actions?)\b|nothing\s+(?:on\s+file|prior|before))/i;

const PRIOR_ACTIONS_KEY = "prior_actions";
const FORM_DATE_KEY = "form_date";
const WARNING_LEVEL_OPTIONS: ReadonlySet<string> = new Set(["verbal", "written"]);

/** The step and the signed date a Prior Actions line names, for telling a repeat. */
function priorLineKey(line: string): string {
  const step = line.split(" — ")[0]!.trim().toLowerCase();
  const date = /signed\s+(\d{2}\/\d{2}\/\d{4})/i.exec(line)?.[1] ?? "";
  return `${step}|${date}`;
}

async function correctCorrectiveActionFacts(input: {
  request: Request;
  instanceId: string;
  question: string;
  today: string;
}): Promise<AskResponse | null> {
  const text = input.question.trim();
  if (text.endsWith("?") || /^(?:what|why|how|when|where|which|who|is|are|does|do|did|should|can|could)\b/i.test(text)) return null;
  const priorLines = statedPriorActions(text, input.today);
  const priorDates = new Set(priorSteps(text, input.today).map((step) => step.iso));
  const firstTime = priorLines.length === 0 && NO_HISTORY.test(text);
  const said = extractFormDate(text, input.today);
  const anotherIncident = describesIncident(text) && !/\b(?:change|switch|set|update|correct|actually|not|was\s+on)\b/i.test(text);
  const date = said && !priorDates.has(said) && said <= input.today && !anotherIncident ? said : null;
  const level = anotherIncident ? null : statedWarningLevel(text);
  if (priorLines.length === 0 && !firstTime && !date && !level) return null;

  let authorized: Awaited<ReturnType<typeof authorizeInstance>>;
  try {
    authorized = await authorizeInstance(input.request, input.instanceId, "edit");
  } catch {
    return null;
  }
  const { actor, loaded } = authorized;
  const document = parseFormDocument(loaded.version.document);
  const variantKey = loaded.instance.variantKey;
  const fields = fieldsForVariant(document, variantKey);
  const keys = new Set(fields.map((field) => field.key));
  const warningGroup = checkboxGroupsForVariant(document, variantKey).find((group) => group.key === WARNING_TYPE_KEY);
  if (!keys.has(PRIOR_ACTIONS_KEY) || !warningGroup) return null;

  // A request for a form, or a turn about somebody else, is left to the ordinary flow.
  const intent = detectTemplateIntent(text);
  if (intent.kind === "ambiguous" || (intent.kind === "corrective_action" && intent.requestedCreation)) return null;
  if (intent.kind === "explicit" && (intent.templateKey !== loaded.instance.templateKey || /\b(?:create|start|pull up|new|another)\b|\bmake\s+(?:a|an)\b|\bneed\s+(?:a|an)\b/i.test(text))) {
    return null;
  }
  const named = extractEmployeeNames(text);
  if (named.length > 0 && !named.some((name) => samePerson(name, loaded.instance.employeeName))) return null;

  if (loaded.instance.status !== "draft") {
    return changeOnEditableDraft(input.request, input.instanceId, (draftId) =>
      correctCorrectiveActionFacts({ ...input, instanceId: draftId }),
    );
  }

  const values: Record<string, string> = {};
  const checked: Record<string, string[]> = {};
  const notes: string[] = [];
  const existing = (loaded.values.find((row) => row.fieldKey === PRIOR_ACTIONS_KEY)?.value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const kept = existing.filter((line) => line !== NO_PRIOR_ACTION);
  const added = priorLines.filter((line) => !kept.some((have) => priorLineKey(have) === priorLineKey(line)));
  if (added.length > 0) values[PRIOR_ACTIONS_KEY] = [...kept, ...added].join("\n");
  if (firstTime) {
    if (kept.length === 0 && existing[0] !== NO_PRIOR_ACTION) values[PRIOR_ACTIONS_KEY] = NO_PRIOR_ACTION;
    else if (kept.length > 0) notes.push(`Prior Actions already lists ${kept.length === 1 ? "an earlier step" : "earlier steps"}, so I left it as it is — change it on the form if that list is wrong.`);
  }
  const currentDate = loaded.values.find((row) => row.fieldKey === FORM_DATE_KEY)?.value ?? "";
  if (date && keys.has(FORM_DATE_KEY) && date !== currentDate) values[FORM_DATE_KEY] = date;
  if (level && warningGroup.options.some((option) => option.key === level)) {
    const ticked = loaded.values.find((row) => row.fieldKey === WARNING_TYPE_KEY)?.checked ?? [];
    const next = [...ticked.filter((option) => !WARNING_LEVEL_OPTIONS.has(option)), level];
    if (next.join(",") !== ticked.join(",")) checked[WARNING_TYPE_KEY] = next;
  }

  if (Object.keys(values).length === 0 && Object.keys(checked).length === 0) {
    return notes.length > 0 ? reply(notes.join("\n\n")) : null;
  }
  const submitted = { values, checked };
  const accepted = enforcePersonEdit(document, variantKey, submitted);
  const refused = new Set(accepted.rejected.map((entry) => entry.key));
  const saved = await saveInstanceValues(input.instanceId, { values: accepted.values, checked: accepted.checked }, actor.id);
  const refusedOnSave = new Set(saved.rejected.map((entry) => entry.key));
  const written = [...Object.keys(values), ...Object.keys(checked)].filter((key) => !refused.has(key) && !refusedOnSave.has(key));
  if (written.length === 0) return null;

  const who = `**${loaded.instance.templateName}** for **${loaded.instance.employeeName}**`;
  const field = (key: string) => fields.find((entry) => entry.key === key);
  const described = written.map((key) => {
    if (key === PRIOR_ACTIONS_KEY) {
      return added.length > 0
        ? `${field(key)?.label ?? key} → added ${added.map((line) => `"${line}"`).join(", ")}`
        : `${field(key)?.label ?? key} → ${NO_PRIOR_ACTION}`;
    }
    if (key === WARNING_TYPE_KEY) {
      const label = warningGroup.options.find((option) => option.key === level)?.label ?? level;
      return `Type of Warning → ${label}`;
    }
    return `${field(key)?.label ?? key} → ${field(key)?.input === "date" ? displayDate(values[key]!, document.style) : values[key]}`;
  });
  return {
    ...reply([`Updated the ${who}: ${described.join("; ")}.`, ...notes.map((note) => `\n${note}`)].join("\n")),
    formUpdate: { instanceId: input.instanceId, updated: written },
  };
}

function reply(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}

/**
 * "New Location → Salon 24", "Type of Demotion → Voluntary", in the form's own
 * labels. A yes/no the exit form states as a Details line is described in
 * that line's own sentence — "Salon Key Returned → Salon key was returned." —
 * so the chat says what the page now says. A group cleared by the correction
 * is named as unticked, or left out when nothing was ticked there.
 */
function describe(
  document: FormDocument,
  variantKey: string | null,
  key: string,
  submitted: { values: Record<string, string>; checked: Record<string, string[]> },
  ticks: { before: Record<string, string[]>; after: Record<string, string[]> },
): string | null {
  const field = fieldsForVariant(document, variantKey).find((entry) => entry.key === key);
  if (field) {
    const value = submitted.values[key] ?? "";
    return `${field.label} → ${field.input === "date" ? displayDate(value, document.style) : value}`;
  }
  const statement = blocksForVariant(document, variantKey)
    .flatMap((block) => (block.kind === "answer_statements" ? block.lines : []))
    .find((line) => line.parts.some((part) => part.key === key));
  if (statement) {
    const sentence = answerStatementText(statement, ticks.after);
    if (sentence) return `${statement.label} → ${sentence}`;
  }
  const group = checkboxGroupsForVariant(document, variantKey).find((entry) => entry.key === key);
  const label = (option: string) => group?.options.find((entry) => entry.key === option)?.label ?? option;
  if ((submitted.checked[key] ?? []).length === 0) {
    const was = ticks.before[key] ?? [];
    return was.length > 0 ? `Unticked ${was.map(label).join(", ")}` : null;
  }
  const options = (submitted.checked[key] ?? []).map(label).join(", ");
  // The separation boxes have no question of their own; the ticked box says it all.
  return group?.label ? `${group.label} → ${options}` : `Ticked ${options}`;
}
