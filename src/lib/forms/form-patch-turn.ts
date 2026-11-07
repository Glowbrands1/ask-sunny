import "server-only";

import type { AskResponse } from "@/lib/ai/types";
import { formEditSingleWriterEnabled, formPatchReaderFixesEnabled } from "@/lib/config/chat-quality-flags";
import { syncCorrectiveActionPlan } from "./ca-action-plan-sync";
import { checkboxGroupsForVariant, fieldsForVariant, parseFormDocument } from "./document";
import { replyFromDiff } from "./form-diff-reply";
import { readFormPatch, type FormPatchReading } from "./form-patch-model";
import type { FormPatchField, FormPatchInput, FormPatchReadOnly, FormPatchTurn } from "./form-patch-prompt";
import { MANAGER_STATED_KEYS, statedDates, templateRules } from "./form-reducer-draft";
import { applyPatch, draftFromRows, fold, type FieldValue, type PatchRules } from "./form-reducer";
import { formLabels, snapshotDiff, snapshotOf } from "./form-snapshot";
import { authorizeInstance } from "./instance-scope";
import { applyAssistantRevision, applyStatedFacts, loadInstance, saveInstanceValues } from "./instances";
import { NO_PRIOR_ACTION, PRIOR_ACTIONS_KEY } from "./prior-actions";
import { draftableCheckboxGroups, draftableFields } from "./responsibility";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * A CHAT TURN ON THE OPEN DRAFT, AS ONE PATCH (FORM_PATCH_REDUCER_ENABLED)
 * ============================================================================
 *
 * Step B. With a draft open, the manager's latest message is read once by the
 * form-patch model (`form-patch-model.ts`) into a patch — field, value, add or
 * replace, and the words it came from — and `applyPatch` in edit mode decides
 * what of it reaches the form: the evidence must be the manager's own words
 * (or the assistant's offer they accepted), a typed field is never blanked or
 * replaced by offered text, payroll and its amount only as stated, a date
 * only one the manager gave.
 *
 * The write goes through the existing writers: the assistant's keys through
 * `applyAssistantRevision`, a field the manager typed through
 * `saveInstanceValues` (it stays theirs), the payroll answer and amount through
 * `applyStatedFacts` (manager's statement, empty fields only), and the Action
 * Plan through `syncCorrectiveActionPlan` when payroll changed. The form is
 * read again and the reply is the realized diff: "Changed X to …", or "I
 * didn't change anything on the form." — never an "Updated" without a change.
 *
 * Null — the old path runs — when the turn is not about this form, on any
 * model fallback, on an error, for a finalized form, and for a Corrective
 * Action Form the assistant has written nothing on (the cited redraft owns it).
 */

/** The template's input, in the words the prompt uses. */
function kindOf(input: string): string {
  return input === "long_text" ? "long text" : input;
}

function shownValue(value: FieldValue | undefined): FieldValue {
  return value ?? "";
}

function managerTurns(history: readonly Pick<ChatMessage, "role" | "content" | "error">[], question: string): string[] {
  return [...history.filter((turn) => turn.role === "user" && !turn.error).map((turn) => turn.content), question];
}

function lastAssistant(history: readonly Pick<ChatMessage, "role" | "content" | "error">[]): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    if (turn.role === "assistant" && !turn.error) return turn.content;
  }
  return undefined;
}

/**
 * FORM_PATCH_READER_FIXES_ENABLED: every value the reader set is already what the form says. One honest line,
 * no `formUpdate`, never "Updated".
 */
function alreadyThere(keys: readonly string[], labels: Readonly<Record<string, string>>): AskResponse {
  const named = [...new Set(keys.map((key) => labels[key] ?? key))].filter((label) => label.trim() !== "");
  const which = named.length > 0 ? `**${named.join("**, **")}** already says that` : "The form already says that";
  return { content: `${which}, so I didn't change anything on the form.`, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}

type PatchTurnInput = {
  request: Request;
  instanceId: string;
  question: string;
  history: Pick<ChatMessage, "id" | "role" | "content" | "error">[];
  /** The business day, YYYY-MM-DD. */
  today: string;
};

/** Everything the turn reads from the loaded form before the model call, and the model's input. Null: not this path's form. */
function preparePatch(loaded: Awaited<ReturnType<typeof authorizeInstance>>["loaded"], input: PatchTurnInput) {
    const document = parseFormDocument(loaded.version.document);
    const variantKey = loaded.instance.variantKey;
    const aiFields = draftableFields(document, variantKey);
    const aiGroups = draftableCheckboxGroups(document, variantKey);

    /* A blank Corrective Action Form: the cited redraft (`chat-redraft.ts`) drafts it whole. */
    const corrective = aiFields.some((field) => field.key === "policy_language") && aiGroups.some((group) => group.key === "offense_type");
    const assistantWrote = loaded.values.some(
      (row) => row.filledBy === "ai" && ((row.value ?? "").trim() !== "" || row.checked.length > 0),
    );
    if (corrective && !assistantWrote) return null;

    const template = templateRules(loaded);
    const before = draftFromRows(loaded.values);
    const allFields = fieldsForVariant(document, variantKey);
    const allGroups = checkboxGroupsForVariant(document, variantKey);
    const labels = formLabels(loaded);

    /* What the model may set: the reducer's keys, and the payroll answer and amount where the form has them. */
    const stated = new Set([...allFields.map((field) => field.key), ...allGroups.map((group) => group.key)].filter((key) => MANAGER_STATED_KEYS.has(key)));
    /*
     * FORM_PATCH_READER_FIXES_ENABLED (coding 5, 7 Nov 2026): the form's Job Title, set only to the latest
     * message's words ("change her position to Team Member"), written as the manager's own edit.
     */
    const fixes = formPatchReaderFixesEnabled();
    const verbatim = new Set(fixes ? allFields.filter((field) => field.key === "job_title").map((field) => field.key) : []);
    const writable = new Set([...template.writable, ...stated, ...verbatim]);
    const fields: FormPatchField[] = [];
    const readOnly: FormPatchReadOnly[] = [];
    for (const field of allFields) {
      const current = before[field.key];
      if (writable.has(field.key)) {
        fields.push({ key: field.key, label: labels[field.key] ?? field.key, kind: kindOf(field.input), filledBy: current?.owner ?? "empty", value: shownValue(current?.value) });
      } else if (field.responsibility !== "signature" && current && current.owner !== "empty") {
        readOnly.push({ label: labels[field.key] ?? field.key, value: current.value });
      }
    }
    for (const group of allGroups) {
      const current = before[group.key];
      if (writable.has(group.key)) {
        fields.push({
          key: group.key,
          label: labels[group.key] ?? group.key,
          kind: "checkbox",
          filledBy: current?.owner ?? "empty",
          value: shownValue(current?.value),
          options: group.options.map((option) => option.key),
          single: group.single === true,
        });
      } else if (current && current.owner !== "empty") {
        readOnly.push({ label: labels[group.key] ?? group.key, value: current.value });
      }
    }

    const turns: FormPatchTurn[] = input.history
      .filter((turn) => !turn.error && (turn.role === "user" || turn.role === "assistant"))
      .map((turn) => ({ role: turn.role === "user" ? "manager" : "assistant", content: turn.content }));
    /* FORM_PATCH_READER_FIXES_ENABLED: what the form already holds counts as said (its name, its text). */
    const readerFixes = fixes
      ? {
          employeeName: loaded.instance.employeeName ?? "",
          formText: loaded.values.map((row) => row.value ?? "").filter((value) => value.trim() !== "").join("\n"),
          verbatimKeys: verbatim,
        }
      : null;
    const modelInput: FormPatchInput = {
      today: input.today,
      templateName: loaded.instance.templateName,
      employeeName: loaded.instance.employeeName || null,
      fields,
      readOnly,
      turns,
      latest: input.question,
    };
    return { template, before, allFields, allGroups, labels, stated, verbatim, writable, readerFixes, modelInput };
}

/*
 * FORM_PATCH_READER_FIXES_ENABLED (QA's latency ask, 7 Nov 2026): the route starts the reading as soon as
 * the turn is known, so the model call runs while the route's other steps do. Kept per request, and used
 * only when the turn's own input is the same, word for word; otherwise the turn calls the model itself.
 */
const early = new WeakMap<Request, { key: string | null; reading: Promise<FormPatchReading> }>();

/** Starts the patch reading for this turn (no write). Never throws; a failure is simply no early reading. */
export function startPatchReading(input: PatchTurnInput): void {
  if (!formPatchReaderFixesEnabled()) return;
  const entry: { key: string | null; reading: Promise<FormPatchReading> } = { key: null, reading: Promise.resolve({ fallback: "error" }) };
  entry.reading = (async (): Promise<FormPatchReading> => {
    const { loaded } = await authorizeInstance(input.request, input.instanceId, "edit");
    if (loaded.instance.status !== "draft") return { fallback: "no_fields" };
    const prepared = preparePatch(loaded, input);
    if (!prepared) return { fallback: "no_fields" };
    entry.key = JSON.stringify(prepared.modelInput);
    return readFormPatch(prepared.modelInput);
  })().catch((): FormPatchReading => ({ fallback: "error" }));
  early.set(input.request, entry);
}

/** The early reading when it was made from this very input; otherwise the model is called now. */
async function readingFor(input: PatchTurnInput, modelInput: FormPatchInput): Promise<FormPatchReading> {
  const started = early.get(input.request);
  early.delete(input.request);
  if (started) {
    const reading = await started.reading;
    if (started.key !== null && started.key === JSON.stringify(modelInput)) return reading;
  }
  return readFormPatch(modelInput);
}

export async function patchActiveForm(input: PatchTurnInput): Promise<AskResponse | null> {
  // FORM_PATCH_READER_FIXES_ENABLED: a previous turn's "found nothing" never reaches this one.
  if (formPatchReaderFixesEnabled()) (await import("./reader-found-nothing")).clearReaderFoundNothing(input.instanceId);
  try {
    let authorized: Awaited<ReturnType<typeof authorizeInstance>>;
    try {
      authorized = await authorizeInstance(input.request, input.instanceId, "edit");
    } catch {
      return null;
    }
    const { actor, loaded } = authorized;
    if (loaded.instance.status !== "draft") return null;

    const prepared = preparePatch(loaded, input);
    if (!prepared) return null;
    const { template, before, allGroups, labels, stated, verbatim, writable, readerFixes, modelInput } = prepared;
    const reading = await readingFor(input, modelInput);
    /* FORM_PATCH_READER_FIXES_ENABLED: every hand-off after a reading tells the old path's revision (no instruction, no repeat). */
    const handOff = async (): Promise<null> => {
      if (readerFixes) {
        // The reader's evidence for text it set from her latest message: the revision's new content keeps it.
        const evidence =
          "ok" in reading
            ? Object.fromEntries(Object.entries(reading.patch.evidence ?? {}).filter(([key, quote]) => key in reading.patch.set && fold(input.question).includes(fold(quote))))
            : {};
        (await import("./reader-found-nothing")).noteReaderFoundNothing(input.instanceId, evidence);
      }
      return null;
    };
    if (!("ok" in reading) || reading.turn !== "this_form") return handOff();
    /*
     * QA, 3 Nov 2026 (blocker before the Step B flip; ported from Ask
     * Bubbles): "make it sound more professional" is about this form, but the
     * manager gives nothing to set from their own words. A patch that sets and
     * clears nothing is not this path's turn: null, so the redraft and
     * revision paths run as before. (A patch whose sets were all refused still
     * answers from its diff.)
     */
    if (Object.keys(reading.patch.set).length === 0 && reading.patch.clear.length === 0) return handOff();

    /*
     * The assistant's last reply counts as accepted only when the patch quotes
     * it: some evidence is in that reply and not in the manager's words. A
     * turn that is about this form but quotes only the manager does not make
     * every word of the reply "said" (the reducer's half-the-words floor reads
     * the accepted offer too).
     */
    const said = managerTurns(input.history, input.question).join("\n");
    const offered = lastAssistant(input.history);
    const quotesOffer =
      offered !== undefined &&
      Object.values(reading.patch.evidence ?? {}).some((evidence) => {
        const want = fold(evidence);
        return want !== "" && !fold(said).includes(want) && fold(offered).includes(want);
      });
    const groups = Object.fromEntries(
      allGroups.filter((group) => writable.has(group.key)).map((group) => [group.key, { options: group.options.map((option) => option.key), single: group.single === true }]),
    );
    const rules: PatchRules = {
      mode: "edit",
      writable,
      managerStated: stated,
      dateKeys: template.dateKeys,
      datesIn: statedDates(input.today),
      checkboxGroups: groups,
      listKeys: new Set([PRIOR_ACTIONS_KEY]),
      listNone: NO_PRIOR_ACTION,
      ...(readerFixes
        ? {
            faithful: { employeeName: readerFixes.employeeName, formText: readerFixes.formText, latest: input.question },
            verbatimKeys: verbatim,
            noRepeat: true,
            echoOf: {
              latest: input.question,
              name: readerFixes.employeeName,
              formWords: Object.fromEntries(Object.entries(labels).map(([key, label]) => [key, `${label} ${loaded.instance.templateName ?? ""}`])),
            },
          }
        : {}),
      sources: {
        manager: said,
        managerTurns: managerTurns(input.history, input.question),
        offered,
        accepted: reading.turn === "this_form" && quotesOffer,
      },
    };
    /*
     * FORM_EDIT_SINGLE_WRITER_ENABLED: the patch is handed to the one writer
     * (`lib/forms/form-write.ts`, path "patch") with these same rules; the
     * owner split below moved there. A patch with any refusal writes nothing
     * and the turn goes on (redraft, revision).
     */
    if (formEditSingleWriterEnabled()) {
      const ops = [
        ...Object.entries(reading.patch.set).map(([field, value]) => ({
          op: reading.patch.how?.[field] === "add" ? ("append" as const) : ("set" as const),
          field,
          value,
          ...(reading.patch.evidence?.[field] !== undefined ? { evidence: reading.patch.evidence[field] } : {}),
          // FORM_PATCH_READER_FIXES_ENABLED: a reword, and the Job Title as the manager's own edit.
          ...(readerFixes && reading.patch.how?.[field] === "reword" ? { reword: true } : {}),
          ...(readerFixes && verbatim.has(field) ? { by: "manager" as const } : {}),
        })),
        ...reading.patch.clear.map((field) => ({
          op: "clear" as const,
          field,
          ...(reading.patch.evidence?.[field] !== undefined ? { evidence: reading.patch.evidence[field] } : {}),
        })),
      ];
      const result = await (await import("./form-write")).writeFormEdits(input.instanceId, ops, {
        path: "patch",
        actorId: actor.id,
        latest: input.question,
        managerTurns: managerTurns(input.history, input.question),
        ...(offered !== undefined ? { offered } : {}),
        acceptedOffer: rules.sources?.accepted ?? false,
        today: input.today,
        loaded,
        writable,
        statedKeys: stated,
        syncPlan: { after: [...stated], amountSentence: true, notes: input.question },
        ...(readerFixes ? { readerFixes } : {}),
      });
      if (result.handoff === "refused") return handOff();
      /*
       * FORM_PATCH_READER_FIXES_ENABLED (QA's live run, 7 Nov 2026: "yes, do that" after the edit was saved went
       * to the old path, whose revision rewrote the form and said "Updated"): what the reader set is already on
       * the form. Said so; the old path does not run.
       */
      if (readerFixes && result.handoff === "noop") return alreadyThere(Object.keys(reading.patch.set), labels);
    } else {
      const { diff } = applyPatch(before, reading.patch, rules);

      const groupKeys = new Set(allGroups.map((group) => group.key));
      const assistant = { values: {} as Record<string, string>, checked: {} as Record<string, string[]> };
      const statement = { values: {} as Record<string, string>, checked: {} as Record<string, string[]> };
      /*
       * QA, 3 Nov 2026 (option A): an "add" to a field the manager typed stays
       * the manager's. The merged text is saved as their own edit
       * (`saveInstanceValues`, filled by the manager), so a later redraft keeps
       * it like any typed line. Only a field the saved row already says is the
       * manager's (`draftFromRows`), nothing wider.
       */
      const typed = { values: {} as Record<string, string>, checked: {} as Record<string, string[]> };
      const cleared: string[] = [];
      for (const change of diff.changed) {
        // FORM_PATCH_READER_FIXES_ENABLED: the Job Title is written as the manager's own edit.
        const target = stated.has(change.key) ? statement : before[change.key]?.owner === "manager" || verbatim.has(change.key) ? typed : assistant;
        const after = change.after;
        const empty = typeof after === "string" ? after.trim() === "" : after.length === 0;
        if (empty) {
          if (!stated.has(change.key)) cleared.push(change.key);
          continue;
        }
        if (groupKeys.has(change.key)) target.checked[change.key] = typeof after === "string" ? [after] : [...after];
        else target.values[change.key] = typeof after === "string" ? after : after.join("\n");
      }

      if (Object.keys(assistant.values).length + Object.keys(assistant.checked).length + cleared.length > 0) {
        await applyAssistantRevision(input.instanceId, assistant, cleared, actor.id);
      }
      if (Object.keys(typed.values).length + Object.keys(typed.checked).length > 0) {
        await saveInstanceValues(input.instanceId, typed, actor.id);
      }
      const statedWritten =
        Object.keys(statement.values).length + Object.keys(statement.checked).length > 0
          ? await applyStatedFacts(input.instanceId, statement, actor.id, stated)
          : [];
      /* Payroll changed: the Action Plan Ask Sunny built says so (never a plan a person wrote). */
      if (statedWritten.length > 0) {
        await syncCorrectiveActionPlan(input.instanceId, actor.id, { amountSentence: true, notes: input.question });
      }
    }

    const reloaded = await loadInstance(input.instanceId);
    if (!reloaded) return null;
    const changed = snapshotDiff(snapshotOf(loaded), snapshotOf(reloaded));
    /* FORM_PATCH_READER_FIXES_ENABLED: the reader's values are already on the form (the old writers' path). */
    if (readerFixes && changed.length === 0) return alreadyThere(Object.keys(reading.patch.set), labels);
    return {
      content: replyFromDiff({ changed }, labels),
      citations: [],
      coverage: "not_applicable",
      recommendedVideoIds: [],
      ...(changed.length > 0 ? { formUpdate: { instanceId: input.instanceId, updated: changed.map((change) => change.key) } } : {}),
    };
  } catch {
    return null;
  }
}
