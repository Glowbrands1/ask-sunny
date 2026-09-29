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
import { CORRECTABLE_KEYS, correctionValues, employmentChangeKind } from "./employment-change";
import { EXIT_CORRECTABLE_KEYS, exitCorrectionValues } from "./exit-details";
import { isExitDocumentKeys } from "./exit-draft";
import { authorizeInstance } from "./instance-scope";
import { PAYROLL_DEDUCT_KEY, payrollDeductChecked, payrollDeductCorrection } from "./payroll-deduct";
import { extractEmployeeNames } from "./proposal";
import { detectTemplateIntent } from "./template-intent";
import { saveInstanceValues } from "./instances";

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
 * path as typing into the field — so it is recorded as the manager's, refused
 * on a finalized form, and limited to fields a person may edit.
 */
export async function correctActiveForm(input: {
  request: Request;
  instanceId: string;
  question: string;
  today: string;
}): Promise<AskResponse | null> {
  // A cheap first reading, before anything is loaded: most turns are not corrections.
  const employmentCorrection = correctionValues(input.question, input.today);
  const exitCorrection = exitCorrectionValues(input.question, input.today);
  const payroll = payrollDeductCorrection(input.question);
  if (!employmentCorrection && !exitCorrection && !payroll) return null;

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
  if (loaded.instance.status !== "draft") {
    return reply(
      `The ${who} is finalized, so I haven't changed it. Open it from Form Monitoring and create a revision to make a change.`,
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

  const { rejected } = await saveInstanceValues(input.instanceId, submitted, actor.id);
  const refused = new Set(rejected.map((entry) => entry.key));
  const updated = keys.filter((key) => !refused.has(key));
  if (updated.length === 0) return null;

  const before = Object.fromEntries(loaded.values.map((row) => [row.fieldKey, row.checked]));
  const after = { ...before, ...submitted.checked };
  const described = updated
    .map((key) => describe(document, variantKey, key, submitted, { before, after }))
    .filter((line): line is string => line !== null);

  const reason =
    kind || isExit
      ? loaded.values.find((row) => row.fieldKey === "reason" || row.fieldKey === "details")
      : undefined;
  // The exit form's paragraph is printed as "Additional Details" from revision 2.
  const paragraph =
    reason?.fieldKey === "details"
      ? `${fieldsForVariant(document, variantKey).find((field) => field.key === "details")?.label ?? "Details"} paragraph`
      : "reason paragraph";
  const lines = [
    `Updated the ${who}: ${described.length > 0 ? described.join("; ") : "Resignation Details boxes cleared"}.`,
  ];
  if ((reason?.value ?? "").trim() !== "") {
    lines.push("", `The ${paragraph} was written before this change — give it a quick read to make sure it still matches.`);
  }

  return { ...reply(lines.join("\n")), formUpdate: { instanceId: input.instanceId, updated } };
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
