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
import { formDateChange, formDateChangeUnclear, formDateReply } from "./form-date-answer";
import { resolveFormDate, withDateMoved } from "./form-date-grounding";
import { authorizeInstance } from "./instance-scope";
import { syncCorrectiveActionPlan } from "./ca-action-plan-sync";
import {
  PAYROLL_DEDUCT_KEY,
  payrollDeductChecked,
  payrollDeductCorrection,
  payrollDeductReply,
  payrollDeductUnclear,
} from "./payroll-deduct";
import { extractEmployeeNames } from "./proposal";
import { detectTemplateIntent } from "./template-intent";
import { applyAssistantDraft, saveInstanceValues } from "./instances";
import { correctCaFromChat } from "./ca-chat-corrections";
import { enforcePersonEdit } from "./responsibility";

/** The form's own Date line. */
const FORM_DATE_KEY = "form_date";

/*
 * THE FORMS WHOSE DATE IS THE INCIDENT'S — corrected from chat, the drafted
 * observation's date moving with it. The business decided this for the
 * Corrective Action Form on 22 Oct 2026, after the QA audit of the District
 * Manager's 21 Oct reports (ported from Ask Bubbles, where it is the forms
 * registry's `formDateIsIncidentDate`). Its employee name is still corrected
 * on the form, never from chat.
 */
const FORM_DATE_IS_INCIDENT_DATE: ReadonlySet<string> = new Set(["dpoa"]);

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
  const lastAssistant =
    [...(input.history ?? [])].reverse().find((turn) => turn.role === "assistant" && !turn.error)?.content ?? "";
  // A cheap first reading, before anything is loaded: most turns are not corrections.
  const employmentCorrection = correctionValues(input.question, input.today);
  const exitCorrection = exitCorrectionValues(input.question, input.today);
  const payroll = payrollDeductCorrection(input.question) ?? payrollDeductReply(input.question, lastAssistant);
  /*
   * Something about the deduction that is not a clear Yes or No — "hold off on
   * the $25 payroll deduction". On a form that asks the question it clears the
   * answer and asks again (see below), never leaving a Yes in place.
   */
  const payrollUnclear = !payroll && payrollDeductUnclear(input.question);
  /*
   * "CHANGE THE DATE TO 10-19-26" — read only where the date is named as what
   * is corrected; "change the date" or "10-2 or 10-3" is asked about, never
   * guessed. See `formDateChange`.
   */
  const newFormDate =
    formDateChange(input.question, input.today) ?? formDateReply(input.question, lastAssistant, input.today);
  const dateUnclear = newFormDate === null ? formDateChangeUnclear(input.question, input.today) : null;
  if (!employmentCorrection && !exitCorrection && !payroll && !payrollUnclear && !newFormDate && !dateUnclear) {
    /*
     * A DATE ON AN OPEN CORRECTIVE ACTION THE READERS ABOVE DO NOT TAKE (owner
     * decision, 22 Oct 2026): "the meeting was actually on 10-19-26", a prior
     * action's date. The readers above own the Date line ("change the date to
     * 10-2-26"); the CA's reader (`ca-chat-corrections.ts`) answers what they
     * leave, and is null for anything else.
     */
    return correctCaFromChat({ ...input, lastAssistant });
  }

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
   * Form. That answer and the form's date are what such a form takes from
   * chat; its other lines are edited on the form. Read off the version's keys,
   * so no template key is special-cased.
   */
  const asksPayroll = checkboxGroupsForVariant(document, variantKey).some(
    (group) => group.key === PAYROLL_DEDUCT_KEY,
  );
  // The Exit Form, read off the pinned version's keys as the drafting route does.
  const isExit = !kind && isExitDocumentKeys(responsibilityMap(document, variantKey).keys());
  const datesTheIncident =
    !kind &&
    !isExit &&
    FORM_DATE_IS_INCIDENT_DATE.has(loaded.instance.templateKey) &&
    fieldsForVariant(document, variantKey).some((field) => field.key === FORM_DATE_KEY);
  const correctsDate = datesTheIncident && newFormDate !== null;
  const whichDate = datesTheIncident && dateUnclear ? whichDateQuestion(loaded.instance, dateUnclear.offered) : null;
  const correctsOtherwise = kind || isExit || (asksPayroll && (payroll || payrollUnclear)) || correctsDate;
  if (!correctsOtherwise && !whichDate) return null;
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
  // Only now, past the new-request and other-employee guards: nothing else to correct, so ask which date.
  if (!correctsOtherwise) return reply(whichDate!);

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
      : {
          values: correctsDate ? { [FORM_DATE_KEY]: newFormDate! } : {},
          checked: asksPayroll
            ? payrollUnclear
              ? { [PAYROLL_DEDUCT_KEY]: [] }
              : payrollDeductChecked(payroll)
            : {},
        };
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
      : new Set([PAYROLL_DEDUCT_KEY, FORM_DATE_KEY]);
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
  /*
   * THE OBSERVATION MOVES WITH THE DATE. A corrected form date also moves the
   * day it replaces in what was observed, where Ask Sunny drafted it — so the
   * Date line and the observation never disagree. Written as Ask Sunny's own,
   * after the date, the way the Action Plan is kept in step, so it moves again
   * on the next correction. Never Prior Actions, a policy line or a plan, and
   * never a paragraph a person wrote or edited: that is named for them.
   */
  const movedDate: Record<string, string> = {};
  const datedByHand: string[] = [];
  if (correctsDate && updated.includes(FORM_DATE_KEY)) {
    const was = loaded.values.find((row) => row.fieldKey === FORM_DATE_KEY)?.value ?? loaded.instance.formDate;
    for (const field of fieldsForVariant(document, variantKey)) {
      if (field.key === FORM_DATE_KEY || field.narrative !== "observed_expectation") continue;
      const row = loaded.values.find((entry) => entry.fieldKey === field.key);
      const text = row?.value ?? "";
      if (!was || text.trim() === "") continue;
      const moved = withDateMoved(text, was, newFormDate!);
      if (moved === text) continue;
      if (row!.filledBy === "ai") movedDate[field.key] = moved;
      else datedByHand.push(field.label);
    }
  }
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
  const movedKeys =
    Object.keys(movedDate).length > 0 && written.includes(FORM_DATE_KEY)
      ? Object.keys(
          (
            await applyAssistantDraft(
              input.instanceId,
              { values: movedDate, checked: {} },
              actor.id,
              Object.fromEntries(
                Object.keys(movedDate).map((key) => [key, loaded.values.find((row) => row.fieldKey === key)?.provenance ?? {}]),
              ),
            )
          ).accepted.values,
        )
      : [];
  if (movedKeys.length > 0) {
    written.push(...movedKeys);
    const labels = movedKeys.map((key) => fieldsForVariant(document, variantKey).find((field) => field.key === key)?.label ?? key);
    lines.push("", `I moved the date in the ${labels.join(" and ")} too, so it matches the form.`);
  }
  if (datedByHand.length > 0) {
    lines.push("", `The ${datedByHand.join(" and ")} still names the old date — you wrote that, so I left it; check it still says what you mean.`);
  }
  if (planKeys.length > 0) {
    written.push(...planKeys);
    lines.push(
      "",
      payroll === "yes" ? "The Action Plan now states the payroll deduction." : "The Action Plan no longer states a payroll deduction.",
    );
  }
  /*
   * AN UNCLEAR PAYROLL STATEMENT ABOUT THIS FORM CLEARS THE ANSWER AND ASKS.
   * QA, 22 Oct 2026: after a form with "Yes" was created, "hold off on the $25
   * payroll deduction" or "not sure about the payroll deduction anymore" left
   * the saved Yes — and the Action Plan's deduction sentence — in place while
   * the chat moved on. A Yes the manager may have withdrawn is never kept: the
   * box is cleared, the plan no longer states a deduction, and the manager is
   * asked. Their next "yes" or "no" answers it (`payrollDeductReply`).
   */
  if (payrollUnclear && written.includes(PAYROLL_DEDUCT_KEY)) {
    lines.push(
      "",
      `"${input.question.trim()}" isn't a clear Yes or No, so I cleared the answer rather than keep a Yes on the form. **Is payroll deduct applicable?** Yes or No?`,
    );
  }
  if (whichDate) lines.push("", whichDate);

  return { ...reply(lines.join("\n")), formUpdate: { instanceId: input.instanceId, updated: written } };
}

/** The question a date correction that names no single day is answered with. Nothing is changed. */
function whichDateQuestion(instance: { templateName: string; employeeName: string }, offered: readonly string[]): string {
  const who = `**${instance.templateName}** for **${instance.employeeName}**`;
  const spelled = offered.map((iso) => resolveFormDate(iso)?.long ?? iso);
  return spelled.length > 1
    ? `Which date should the ${who} have — ${spelled.slice(0, -1).join(", ")} or ${spelled.at(-1)}? I haven't changed it.`
    : `What date should the ${who} have? I haven't changed it — tell me the day, for example "change the date to 10-19-26".`;
}

/** "jane", "Jane Doe" and "JANE DOE" name the employee on a form for "Jane Doe". */
function samePerson(named: string, employee: string): boolean {
  const a = named.toLowerCase().replace(/['’]s$/, "").split(/\s+/);
  const b = employee.toLowerCase().split(/\s+/);
  return a.join(" ") === b.join(" ") || (a.length === 1 && a[0] === b[0]);
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
