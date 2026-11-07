import "server-only";

import type { AskResponse } from "@/lib/ai/types";
import { payrollAmounts } from "@/lib/ai/intent-slots";
import { businessToday } from "@/lib/business-date";
import { formEditNoopGuardEnabled, formPatchReaderFixesEnabled } from "@/lib/config/chat-quality-flags";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isGlossaryTerm } from "@/lib/ai/chat-glossary";

import { syncCorrectiveActionPlan } from "./ca-action-plan-sync";
import { checkboxGroupsForVariant, fieldsForVariant, parseFormDocument } from "./document";
import { NOTHING_CHANGED } from "./form-diff-reply";
import { datesInText } from "./form-date-answer";
import {
  applyPatch,
  sameValue,
  type CheckboxGroup,
  type FieldChange,
  type FieldValue,
  type FormDraft,
  type FormPatch,
  type PatchRules,
  type ProtectedValues,
  type Refusal,
} from "./form-reducer";
import { MANAGER_STATED_KEYS, draftDates, statedDates, templateRules, writeInsOf } from "./form-reducer-draft";
import { HEADER_KEYS, checkedClaim, formLabels, snapshotDiff, snapshotOf, type FormSnapshot } from "./form-snapshot";
import {
  applyAssistantDraft,
  applyAssistantRevision,
  applyStatedFacts,
  loadInstance,
  saveInstanceValues,
  type LoadedInstance,
} from "./instances";
import { NO_PRIOR_ACTION, PRIOR_ACTIONS_KEY } from "./prior-actions";
import { takeReaderFoundNothing } from "./reader-found-nothing";
import { draftableCheckboxGroups, draftableFields, type DraftValues } from "./responsibility";
import { copiedContent } from "./same-form-copy";

/**
 * ============================================================================
 * ONE WRITER FOR EVERY FORM EDIT (FORM_EDIT_SINGLE_WRITER_ENABLED)
 * ============================================================================
 *
 * Step 2a (design of 4 Nov 2026; ported from Ask Bubbles 117e33b1, the
 * mechanism, with this app's own readers). Every unprotected path that changes an open
 * draft — a chat correction, a redraft, a same-form copy, a policy change, a
 * reopen, the Action Plan's sync, the stated facts and the patch turn — hands
 * its values here as ops instead of calling a writer. Loaded only by a guarded
 * `await import()`: with the flag off nothing loads this module and every path
 * calls its old writer exactly as before.
 *
 *   1. load → the saved form as a draft (header and rows, `snapshotOf`);
 *   2. the ops become one FormPatch, the evidence the latest message (set by
 *      code); pre-checks (a draft; a field the form has);
 *   3. `applyPatch` with the path's rules (the presets below);
 *   4. ALL OR NOTHING: any refusal writes nothing, `handoff: "refused"`;
 *   5. what changed is split by owner into the EXISTING writers —
 *      `saveInstanceValues` (the manager's), `applyAssistantRevision` (the
 *      assistant's edit, and clears), `applyAssistantDraft` (a draft write,
 *      with its provenance), `applyStatedFacts` (+ `syncCorrectiveActionPlan`);
 *   6. the form read again → `snapshotDiff`.
 *
 * Presets (the reducer's optional rules; see `form-reducer.ts`):
 *
 *   correction  edit mode on the header-aware draft; every op a "replace" with
 *               the manager's statement as its evidence; the name on the form
 *               an accepted offer; the correction readers' own values count as
 *               said (#410); every added word named in the latest message
 *               (owner's Q2 ruling); no word of the old text dropped unless
 *               the latest message names it (`keepsUnnamedWords`, 2b);
 *               written as the manager's.
 *   patch/tool  the patch turn's rules, plus `keepsUnnamedWords`, the strict
 *               naming turn and the write-in rule; split by who wrote the field.
 *   redraft,    draft mode on the template's writable keys (a typed line kept,
 *   copy,       a date only one the manager said); a key outside them is the
 *   stated,     route's own decision and passes through. Written as the
 *   open_draft  assistant's draft (or as the manager's statement, `stated`).
 *   policy,     every op is code's own (the manual's quotation, the derived
 *   plan        line, the rebuilt plan): passed through, never over a typed
 *               line unless `typedExempt`, never blanking one.
 *   revision    (2b; `writeRevisionEdits`) draft mode over the AI fields, the
 *               protected values checked on every rewrite.
 *
 * FORM_EDIT_NOOP_GUARD_ENABLED (Step 4): the tool, patch, revision and
 * correction presets also refuse an op that changes nothing (`same_value`)
 * and one that copies the latest message (`copies_message`).
 *
 * Every preset checks the PROTECTED VALUES (QA condition 2) on a whole-text
 * rewrite, and the write-in rule. Ops marked `derived` (what code computes
 * from a stated value) skip the word rules: they are passed through as
 * computed and written only when they differ.
 *
 * No model is called here; nothing is read from words beyond the reducer's
 * word folding and the app's own date and amount readers.
 */

/* ------------------------------------------------------------- types ---- */

export type FormEditPath =
  | "correction"
  | "redraft"
  | "copy"
  | "policy"
  | "reopen"
  | "plan"
  | "stated"
  | "open_draft"
  | "patch"
  | "tool"
  | "revision";

/** Which existing writer a change goes through. */
export type FormEditWriter = "manager" | "assistant_draft" | "assistant_revision" | "statement" | "by_owner";

export interface FormEditOp {
  readonly op: "set" | "clear" | "append";
  readonly field: string;
  readonly value?: string | readonly string[];
  /** Saved with the value (a draft write only). */
  readonly provenance?: Record<string, unknown>;
  /** Computed by code from what this turn states (a paragraph following its field, a moved date, a rebuilt plan): passed through as computed. */
  readonly derived?: boolean;
  /** Overrides the path's writer for this op. */
  readonly by?: FormEditWriter;
  /** The words the value came from (the patch turn's model). Default: the latest message. */
  readonly evidence?: string;
  /** FORM_PATCH_READER_FIXES_ENABLED: a "set" that rewords the field's text (the reducer's how "reword"). */
  readonly reword?: boolean;
}

export interface FormEditRules {
  readonly path: FormEditPath;
  readonly actorId: string;
  /** The latest message. */
  readonly latest?: string;
  /** The manager's turns, one per line (draft paths: a date only one they said). */
  readonly notes?: string;
  /** The manager's turns one by one (patch path). */
  readonly managerTurns?: readonly string[];
  /** The assistant's last reply, and whether the latest message accepts it (patch path). */
  readonly offered?: string;
  readonly acceptedOffer?: boolean;
  /** The business day, YYYY-MM-DD. */
  readonly today?: string;
  /** What the correction's deterministic readers produced from her words (#410). */
  readonly readerValues?: readonly string[];
  /** Employees the latest message names (protected values). */
  readonly named?: readonly string[];
  /** The form as the caller loaded and authorized it, before this write. */
  readonly loaded?: LoadedInstance;
  /** The keys the ops may reach (patch path; default from the preset). */
  readonly writable?: ReadonlySet<string>;
  /** Keys written as the manager's statement, through `applyStatedFacts` (null: its default keys). */
  readonly statedKeys?: ReadonlySet<string> | null;
  /** Keys a draft may replace although the manager typed them. */
  readonly typedExempt?: ReadonlySet<string>;
  /** CA_NAME_FROM_CHAT_ENABLED: the form's subject column follows the Employee Name line, to this name. */
  readonly employeeColumn?: string | null;
  /** The Action Plan follows when one of `after` was written. */
  readonly syncPlan?: {
    readonly after: readonly string[];
    readonly notes?: string;
    readonly checked?: Record<string, string[]>;
    readonly amountSentence?: boolean;
    readonly loaded?: LoadedInstance;
  };
  /**
   * FORM_PATCH_READER_FIXES_ENABLED (patch path): the form's own name and text count as said, and these
   * keys take only words of the latest message (the reducer's `faithful` and `verbatimKeys`).
   */
  readonly readerFixes?: { readonly employeeName: string; readonly formText: string; readonly verbatimKeys: ReadonlySet<string> };
}

/** What the old writers returned, so a call site keeps its own reply code. */
export interface SavedEdits {
  readonly accepted: DraftValues;
  readonly rejected: { key: string; reason: string }[];
  readonly policyRefused: string[];
  readonly cleared: string[];
  readonly statedKeys: string[];
  readonly planKeys: string[];
  /** Every op already held its value: the reply to give, with no `formUpdate`. */
  readonly nothingChanged?: string;
}

export interface FormWriteResult {
  /** What really changed on the saved form, header and rows. */
  readonly changed: readonly FieldChange[];
  readonly refused: readonly Refusal[];
  /** "refused": nothing was written, the turn goes on. "noop": nothing needed writing. */
  readonly handoff: null | "refused" | "noop";
  readonly saved: SavedEdits;
}

/* ----------------------------------------------------------- helpers ---- */

function isClearValue(value: FieldValue | undefined): boolean {
  if (value === undefined) return true;
  return typeof value === "string" ? value.trim() === "" : value.length === 0;
}

function emptySaved(rejected: { key: string; reason: string }[] = []): SavedEdits {
  return { accepted: { values: {}, checked: {} }, rejected, policyRefused: [], cleared: [], statedKeys: [], planKeys: [] };
}

function groupsOf(loaded: LoadedInstance): Record<string, CheckboxGroup> {
  const document = parseFormDocument(loaded.version.document);
  return Object.fromEntries(
    checkboxGroupsForVariant(document, loaded.instance.variantKey).map((group) => [
      group.key,
      { options: group.options.map((option) => option.key), single: group.single === true },
    ]),
  );
}

function dateKeysOf(loaded: LoadedInstance): Set<string> {
  const document = parseFormDocument(loaded.version.document);
  return new Set(fieldsForVariant(document, loaded.instance.variantKey).filter((field) => field.input === "date").map((field) => field.key));
}

function keysOf(loaded: LoadedInstance): Set<string> {
  const document = parseFormDocument(loaded.version.document);
  return new Set([
    ...fieldsForVariant(document, loaded.instance.variantKey).map((field) => field.key),
    ...checkboxGroupsForVariant(document, loaded.instance.variantKey).map((group) => group.key),
  ]);
}

/** The one-fact lines: the header and the template's short text lines (`input: "text"`). */
function wholeValueKeysOf(loaded: LoadedInstance): Set<string> {
  const document = parseFormDocument(loaded.version.document);
  return new Set([...HEADER_KEYS, ...fieldsForVariant(document, loaded.instance.variantKey).filter((field) => field.input === "text").map((field) => field.key)]);
}

/** QA condition 2: the form's protected facts, read from the header and the app's own readers. */
export function protectedValuesFor(loaded: LoadedInstance, latest: string, today: string, named: readonly string[] = []): ProtectedValues {
  const groups = groupsOf(loaded);
  return {
    employeeName: loaded.instance.employeeName ?? "",
    datesIn: (text) => datesInText(text, today).map((date) => date.iso),
    amountsIn: (text) => payrollAmounts(text).map(Number),
    latest,
    named,
    formDate: loaded.instance.formDate ?? null,
    // A line whose whole value is the one fact being corrected: a date, the header lines, an amount, a box, a list.
    skip: new Set([...dateKeysOf(loaded), ...HEADER_KEYS, ...MANAGER_STATED_KEYS, ...Object.keys(groups), PRIOR_ACTIONS_KEY]),
  };
}

/**
 * FORM_EDIT_NOOP_GUARD_ENABLED (Step 4): on the paths that write the manager's
 * edit — the tool, the patch turn, the revision and the correction (a reopen
 * is a correction; there only when nothing it states changes) — an op that
 * changes nothing is refused as `same_value`,
 * and a value that holds her whole latest message as `copies_message`. Both
 * hand the turn off, all or nothing. Code's own values (`derived`) and the
 * draft paths are not checked. Off: the rules as before.
 */
const NOOP_GUARDED_PATHS: ReadonlySet<FormEditPath> = new Set(["tool", "patch", "revision", "correction", "reopen"]);

/** The reducer's rules for the path. */
export function presetRules(loaded: LoadedInstance, ops: readonly FormEditOp[], rules: FormEditRules): { patchRules: PatchRules; writable: ReadonlySet<string> } {
  const preset = withReaderFoundNothing(loaded, rules, basePresetRules(loaded, ops, rules));
  if (!NOOP_GUARDED_PATHS.has(rules.path) || !formEditNoopGuardEnabled()) return preset;
  /*
   * A correction states facts its readers read, a restated one beside the
   * changed one ("change the payroll deduction to $5.00" restates the Yes):
   * same_value only when nothing it states changes, and never when the
   * Action Plan follows it (the same Yes with a new amount moves the plan).
   * Classification, 4 Nov 2026: refusing each restated value lost a real
   * payroll correction (qa-oct21-audit, Issue 4).
   */
  const correction = rules.path === "correction" || rules.path === "reopen";
  const refuseSameValue = !correction ? true : (rules.syncPlan?.after.length ?? 0) > 0 ? false : "whole_patch";
  return { ...preset, patchRules: { ...preset.patchRules, refuseSameValue, copiesMessage: rules.latest ?? "" } };
}

/**
 * FORM_PATCH_READER_FIXES_ENABLED (QA's live run, 7 Nov 2026): when Step B's reader found nothing to write in
 * this message, the revision that runs next may not write text that adds nothing new (`nothingNewFrom`).
 */
function withReaderFoundNothing(
  loaded: LoadedInstance,
  rules: FormEditRules,
  preset: { patchRules: PatchRules; writable: ReadonlySet<string> },
): { patchRules: PatchRules; writable: ReadonlySet<string> } {
  if (!formPatchReaderFixesEnabled()) return preset;
  // QA's 2x run: what the field already says is never written again, on any path that writes her edit.
  if (rules.path === "open_draft" || rules.path === "tool") return { ...preset, patchRules: { ...preset.patchRules, noRepeat: true } };
  if (rules.path !== "revision" && rules.path !== "patch") return preset;
  // The instruction written back as content is refused on both paths (QA's stability run: "Details about the towel.").
  const echoOf = { latest: rules.latest ?? "", name: loaded.instance.employeeName ?? "", formWords: formWordsOf(loaded) };
  const handedOff = rules.path === "revision" ? takeReaderFoundNothing(loaded.instance.id) : null;
  return {
    ...preset,
    patchRules: {
      ...preset.patchRules,
      echoOf,
      noRepeat: true,
      ...(handedOff ? { nothingNewFrom: rules.latest ?? "", ...(Object.keys(handedOff.evidence).length > 0 ? { readerEvidence: handedOff.evidence } : {}) } : {}),
    },
  };
}

/** Per key: the field's own label and the form's name (FORM_PATCH_READER_FIXES_ENABLED's `echoOf`). */
export function formWordsOf(loaded: LoadedInstance): Record<string, string> {
  return Object.fromEntries(Object.entries(formLabels(loaded)).map(([key, label]) => [key, `${label} ${loaded.instance.templateName ?? ""}`]));
}

function basePresetRules(loaded: LoadedInstance, ops: readonly FormEditOp[], rules: FormEditRules): { patchRules: PatchRules; writable: ReadonlySet<string> } {
  const today = rules.today ?? businessToday();
  const latest = rules.latest ?? "";
  // A draft is written from all of the manager's notes: on a draft path they are what names a value that may change.
  const drafts = !["correction", "reopen", "patch", "tool", "revision"].includes(rules.path);
  const guard = protectedValuesFor(loaded, drafts ? [latest, rules.notes ?? ""].join("\n") : latest, today, rules.named);
  const writeIns = writeInsOf(loaded);
  const groups = groupsOf(loaded);
  const lists = new Set([PRIOR_ACTIONS_KEY]);
  const opKeys = new Set(ops.filter((op) => !op.derived).map((op) => op.field));
  switch (rules.path) {
    case "correction":
    case "reopen": {
      return {
        writable: opKeys,
        patchRules: {
          mode: "edit",
          writable: opKeys,
          managerStated: new Set<string>(),
          dateKeys: dateKeysOf(loaded),
          // The app's reader of a stated date: the one this app's correction readers read with (`datesInText`).
          datesIn: statedDates(today),
          checkboxGroups: groups,
          listKeys: lists,
          listNone: NO_PRIOR_ACTION,
          /*
           * Step 2b (QA condition): a correction replaces only the words the
           * manager named — "fix her last name, it is Doe-Smith" may turn
           * "Doe" into "Doe-Smith", never drop "Jane" or the rest of the
           * line, even when her message says "Jane" as part of the new name
           * (`droppedWordsReplaced`). Refused as `drops_words`, all or
           * nothing: the turn goes on.
           */
          keepsUnnamedWords: true,
          droppedWordsReplaced: true,
          wholeValueKeys: wholeValueKeysOf(loaded),
          writeIns,
          protectedValues: guard,
          sources: {
            manager: latest,
            managerTurns: [latest],
            offered: loaded.instance.employeeName ?? "",
            accepted: true,
            readerValues: rules.readerValues ?? [],
            namingTurn: latest,
          },
        },
      };
    }
    case "patch":
    case "tool": {
      const writable = rules.writable ?? templateRules(loaded).writable;
      const turns = rules.managerTurns ?? [latest];
      return {
        writable,
        patchRules: {
          mode: "edit",
          writable,
          managerStated: rules.statedKeys ?? new Set<string>(),
          dateKeys: dateKeysOf(loaded),
          datesIn: statedDates(today),
          checkboxGroups: groups,
          listKeys: lists,
          listNone: NO_PRIOR_ACTION,
          keepsUnnamedWords: true,
          writeIns,
          protectedValues: guard,
          ...(rules.readerFixes
            ? {
                faithful: { employeeName: rules.readerFixes.employeeName, formText: rules.readerFixes.formText, latest },
                verbatimKeys: rules.readerFixes.verbatimKeys,
              }
            : {}),
          sources: {
            manager: turns.join("\n"),
            managerTurns: turns,
            offered: rules.offered,
            accepted: rules.acceptedOffer ?? false,
            namingTurn: latest,
          },
        },
      };
    }
    case "revision": {
      const document = parseFormDocument(loaded.version.document);
      const writable = new Set([
        ...draftableFields(document, loaded.instance.variantKey).map((field) => field.key),
        ...draftableCheckboxGroups(document, loaded.instance.variantKey).map((group) => group.key),
      ]);
      return {
        writable,
        patchRules: {
          mode: "draft",
          writable,
          // The revision decides which field it rewrites (chat-revision.ts); its text is checked here.
          typedExempt: writable,
          checkboxGroups: groups,
          writeIns,
          protectedValues: guard,
          sources: { manager: rules.notes ?? latest },
        },
      };
    }
    default: {
      const template = templateRules(loaded);
      const notes = rules.notes ?? latest;
      return {
        writable: rules.path === "policy" || rules.path === "plan" ? new Set<string>() : template.writable,
        patchRules: {
          mode: "draft",
          writable: template.writable,
          typedExempt: rules.typedExempt ?? new Set<string>(),
          dateKeys: template.dateKeys,
          datesIn: draftDates(today),
          checkboxGroups: template.checkboxGroups,
          listKeys: lists,
          listNone: NO_PRIOR_ACTION,
          writeIns,
          protectedValues: guard,
          sources: { manager: notes, managerTurns: notes.split("\n").map((line) => line.trim()).filter((line) => line !== "") },
        },
      };
    }
  }
}

function defaultWriter(path: FormEditPath): FormEditWriter {
  switch (path) {
    case "correction":
    case "reopen":
      return "manager";
    case "patch":
    case "tool":
      return "by_owner";
    case "revision":
    case "open_draft":
      return "assistant_revision";
    case "stated":
      return "statement";
    default:
      return "assistant_draft";
  }
}

/* ------------------------------------------------------------ writer ---- */

/**
 * The one writer. Returns `{ changed, refused, handoff }` (and what the old
 * writers would have returned, `saved`, for the call site's reply).
 */
export async function writeFormEdits(instanceId: string, ops: readonly FormEditOp[], rules: FormEditRules): Promise<FormWriteResult> {
  const keysOfOps = [...new Set(ops.map((op) => op.field))];
  const refusedAll = (refused: Refusal[]): FormWriteResult => {
    const reasons = new Map(refused.map((refusal) => [refusal.key, refusal.reason]));
    return {
      changed: [],
      refused,
      handoff: "refused",
      saved: emptySaved(keysOfOps.map((key) => ({ key, reason: reasons.get(key) ?? "refused_with_turn" }))),
    };
  };

  /* 1. load */
  const loaded = rules.loaded ?? (await loadInstance(instanceId));
  if (!loaded || loaded.instance.status !== "draft") return refusedAll(keysOfOps.map((key) => ({ key, reason: "not_draft" })));
  const snapshot = snapshotOf(loaded);
  const before: FormDraft = snapshot.draft;

  /* 2. pre-checks, and the ops as one patch */
  const known = keysOf(loaded);
  const refused: Refusal[] = [];
  for (const op of ops) if (!known.has(op.field)) refused.push({ key: op.field, reason: "unknown_field" });
  // CHAT_GLOSSARY_ENABLED: a glossary term ("msb") is never saved as the employee. Off, nothing is refused here.
  for (const op of ops) {
    if (op.field === "employee_name" && op.op !== "clear" && typeof op.value === "string" && isGlossaryTerm(op.value)) refused.push({ key: op.field, reason: "glossary_term" });
  }
  if (isGlossaryTerm(rules.employeeColumn)) refused.push({ key: "employee_name", reason: "glossary_term" });
  if (refused.length > 0) return refusedAll(refused);

  const { patchRules, writable } = presetRules(loaded, ops, rules);
  const latest = rules.latest ?? "";
  const derivedOps: FormEditOp[] = [];
  const set: Record<string, FieldValue> = {};
  const clear: string[] = [];
  const how: Record<string, "add" | "replace" | "reword"> = {};
  const evidence: Record<string, string> = {};
  for (const op of ops) {
    const passes = op.derived === true || (patchRules.mode === "draft" && !writable.has(op.field));
    if (passes) {
      derivedOps.push(op);
      continue;
    }
    if (op.op === "clear") clear.push(op.field);
    else {
      set[op.field] = op.value ?? "";
      how[op.field] = op.op === "append" ? "add" : op.reword ? "reword" : "replace";
    }
    evidence[op.field] = op.evidence ?? latest;
  }
  const patch: FormPatch = { set, clear, how, evidence };

  /* 3. applyPatch */
  const { draft: next, diff } = applyPatch(before, patch, patchRules);
  refused.push(...diff.refused);

  /* Code's own values: as computed, never over a typed line (unless exempt), never blanking one. */
  const writerOf = (op: FormEditOp) => op.by ?? defaultWriter(rules.path);
  const derivedChanges: FieldChange[] = [];
  for (const op of derivedOps) {
    const field = before[op.field];
    const value: FieldValue = op.op === "clear" ? (typeof field?.value === "string" || field === undefined ? "" : []) : (op.value ?? "");
    // The same words with new provenance (a policy line re-verified against the manual) is still a write, as before.
    const stamp = loaded.values.find((row) => row.fieldKey === op.field)?.provenance ?? {};
    const restamped = op.provenance !== undefined && JSON.stringify(op.provenance) !== JSON.stringify(stamp);
    if (sameValue(field?.value, value) && !restamped) continue;
    const typed = field?.owner === "manager";
    const writer = writerOf(op);
    // The draft route's own decision for a key outside the reducer (a derived policy line, the plan it builds) stands, as before.
    const routeDecides = rules.path === "redraft" && !op.derived;
    if (typed && writer !== "manager" && writer !== "statement" && !routeDecides) {
      if (isClearValue(value)) {
        refused.push({ key: op.field, reason: "would_blank" });
        continue;
      }
      if (!(rules.typedExempt?.has(op.field) ?? false)) {
        refused.push({ key: op.field, reason: "typed_by_manager" });
        continue;
      }
    }
    derivedChanges.push({ key: op.field, before: field?.value ?? "", after: value });
  }

  /* 4. all or nothing */
  if (refused.length > 0) return refusedAll(refused);
  const changes = [...diff.changed, ...derivedChanges];
  if (changes.length === 0) {
    return { changed: [], refused: [], handoff: "noop", saved: { ...emptySaved(keysOfOps.map((key) => ({ key, reason: "unchanged" }))), nothingChanged: NOTHING_CHANGED } };
  }

  /* 5. split by owner into the existing writers */
  const groupKeys = new Set(Object.keys(groupsOf(loaded)));
  const opFor = new Map(ops.map((op) => [op.field, op]));
  const buckets: Record<"manager" | "assistant_draft" | "assistant_revision" | "statement", DraftValues> = {
    manager: { values: {}, checked: {} },
    assistant_draft: { values: {}, checked: {} },
    assistant_revision: { values: {}, checked: {} },
    statement: { values: {}, checked: {} },
  };
  const provenance: Record<string, Record<string, unknown>> = {};
  const cleared: string[] = [];
  for (const change of changes) {
    const op = opFor.get(change.key);
    let writer = op ? writerOf(op) : defaultWriter(rules.path);
    if (rules.statedKeys && rules.statedKeys.has(change.key) && rules.path !== "correction" && rules.path !== "reopen") writer = "statement";
    if (writer === "by_owner") writer = before[change.key]?.owner === "manager" ? "manager" : "assistant_revision";
    const after = change.after;
    if (isClearValue(after) && writer !== "manager") {
      if (writer !== "statement") cleared.push(change.key);
      continue;
    }
    const bucket = buckets[writer];
    if (groupKeys.has(change.key)) bucket.checked[change.key] = typeof after === "string" ? (after.trim() === "" ? [] : [after]) : [...after];
    else bucket.values[change.key] = typeof after === "string" ? after : after.join("\n");
    if (op?.provenance) provenance[change.key] = op.provenance;
  }
  void next;

  const accepted: DraftValues = { values: {}, checked: {} };
  const rejected: { key: string; reason: string }[] = [];
  const policyRefused: string[] = [];
  let clearedDone: string[] = [];
  let statedKeys: string[] = [];
  const count = (values: DraftValues) => Object.keys(values.values).length + Object.keys(values.checked).length;
  if (count(buckets.manager) > 0) {
    const saved = await saveInstanceValues(instanceId, buckets.manager, rules.actorId);
    rejected.push(...saved.rejected);
    const refusedKeys = new Set(saved.rejected.map((entry) => entry.key));
    // What the save stored (its required closing re-attached), else what was sent.
    for (const [key, value] of Object.entries(buckets.manager.values)) if (!refusedKeys.has(key)) accepted.values[key] = saved.values?.[key] ?? value;
    for (const [key, value] of Object.entries(buckets.manager.checked)) if (!refusedKeys.has(key)) accepted.checked[key] = value;
  }
  if (count(buckets.assistant_revision) + cleared.length > 0) {
    const saved = await applyAssistantRevision(instanceId, buckets.assistant_revision, cleared, rules.actorId);
    Object.assign(accepted.values, saved.accepted.values);
    Object.assign(accepted.checked, saved.accepted.checked);
    rejected.push(...saved.rejected);
    clearedDone = saved.cleared;
  }
  if (count(buckets.assistant_draft) > 0) {
    const saved = await applyAssistantDraft(instanceId, buckets.assistant_draft, rules.actorId, provenance);
    Object.assign(accepted.values, saved.accepted.values);
    Object.assign(accepted.checked, saved.accepted.checked);
    rejected.push(...saved.rejected);
    policyRefused.push(...saved.policyRefused);
  }
  if (count(buckets.statement) > 0) {
    statedKeys = await applyStatedFacts(instanceId, buckets.statement, rules.actorId, rules.statedKeys ?? undefined);
    for (const key of statedKeys) {
      if (key in buckets.statement.values) accepted.values[key] = buckets.statement.values[key]!;
      if (key in buckets.statement.checked) accepted.checked[key] = buckets.statement.checked[key]!;
    }
  }

  const written = new Set([...Object.keys(accepted.values), ...Object.keys(accepted.checked), ...clearedDone]);
  /* CA_NAME_FROM_CHAT_ENABLED: the form's subject column moves with its Employee Name line. */
  if (rules.employeeColumn && written.has("employee_name")) {
    const { error } = await getSupabaseAdmin().from("form_instances").update({ employee_name: rules.employeeColumn }).eq("id", instanceId);
    if (error) throw new Error(`Could not save the form's employee name: ${error.message}`);
  }
  /* The Action Plan follows what was written (never a plan a person wrote). */
  const planKeys =
    rules.syncPlan && rules.syncPlan.after.some((key) => written.has(key))
      ? await syncCorrectiveActionPlan(instanceId, rules.actorId, {
          ...(rules.syncPlan.notes !== undefined ? { notes: rules.syncPlan.notes } : {}),
          ...(rules.syncPlan.loaded ? { loaded: rules.syncPlan.loaded } : {}),
          ...(rules.syncPlan.checked ? { checked: rules.syncPlan.checked } : {}),
          ...(rules.syncPlan.amountSentence ? { amountSentence: true } : {}),
        })
      : [];

  /* 6. reload → snapshotDiff */
  const reloaded = await loadInstance(instanceId);
  const changed = reloaded ? snapshotDiff(snapshot, snapshotOf(reloaded)) : [];
  return {
    changed,
    refused: [],
    handoff: null,
    saved: { accepted, rejected, policyRefused, cleared: clearedDone, statedKeys, planKeys },
  };
}

/* ------------------------------------------------- adapters for paths ---- */

/** Values and ticks as ops: each a "set" (an empty value a code clear, passed through). */
export function opsFrom(
  values: Readonly<DraftValues> | { values?: Readonly<Record<string, string>>; checked?: Readonly<Record<string, readonly string[]>> },
  extra: Partial<Pick<FormEditOp, "derived" | "by">> = {},
  provenance: Readonly<Record<string, Record<string, unknown>>> = {},
): FormEditOp[] {
  const ops: FormEditOp[] = [];
  for (const [field, value] of Object.entries(values.values ?? {})) {
    ops.push({ op: "set", field, value, ...extra, ...(isClearValue(value) ? { derived: true } : {}), ...(provenance[field] ? { provenance: provenance[field] } : {}) });
  }
  for (const [field, value] of Object.entries(values.checked ?? {})) {
    ops.push({ op: "set", field, value: [...value], ...extra, ...(isClearValue(value) ? { derived: true } : {}), ...(provenance[field] ? { provenance: provenance[field] } : {}) });
  }
  return ops;
}

/** `syncCorrectiveActionPlan`, called from the one writer (its own write goes through `writeFormEdits`, path "plan"). */
export async function syncPlan(
  instanceId: string,
  actorId: string,
  options: Parameters<typeof syncCorrectiveActionPlan>[2] = {},
): Promise<string[]> {
  return syncCorrectiveActionPlan(instanceId, actorId, options);
}

/**
 * The same-form copy through the one writer, path "copy" (#410's wrapper).
 * Returns the keys that really changed, and `nothingChanged` when none did.
 */
export async function copyThroughWriter(input: {
  readonly source: LoadedInstance;
  readonly target: LoadedInstance;
  readonly actorId: string;
  /** The manager's turns, one per line. */
  readonly notes: string;
}): Promise<{ values: Record<string, string>; checked: Record<string, string[]>; nothingChanged?: string; refused?: boolean }> {
  const copied = copiedContent(input.source, input.target);
  if (Object.keys(copied.values).length === 0 && Object.keys(copied.checked).length === 0) return { values: {}, checked: {} };
  const result = await writeFormEdits(input.target.instance.id, opsFrom(copied, {}, copied.provenance), {
    path: "copy",
    actorId: input.actorId,
    notes: input.notes,
    latest: input.notes.split("\n").at(-1) ?? "",
  });
  if (result.handoff === "refused") return { values: {}, checked: {}, refused: true };
  if (result.handoff === "noop") return { values: {}, checked: {}, nothingChanged: NOTHING_CHANGED };
  const values: Record<string, string> = {};
  const checked: Record<string, string[]> = {};
  for (const change of result.changed) {
    if (typeof change.after === "string") values[change.key] = change.after;
    else checked[change.key] = [...change.after];
  }
  if (result.changed.length === 0) return { values, checked, nothingChanged: NOTHING_CHANGED };
  return { values, checked };
}

/**
 * The redraft's claim from what the draft route really changed (#410): its
 * realized `formDiff`. Null when the route returned none — the old reply
 * stands. When nothing changed, the reply says so.
 */
export function redraftOutcome(
  result: { readonly formDiff?: { readonly changed: readonly { key: string }[] } | null },
  policyLine: string | null,
): { updated: string[]; reply: AskResponse | null } | null {
  if (!result.formDiff || !Array.isArray(result.formDiff.changed)) return null;
  const updated = [...new Set(result.formDiff.changed.map((change) => change.key))];
  if (updated.length > 0) return { updated, reply: null };
  return {
    updated,
    reply: { content: [NOTHING_CHANGED, ...(policyLine ? ["", policyLine] : [])].join("\n"), citations: [], coverage: "not_applicable", recommendedVideoIds: [] },
  };
}

/**
 * Reopen (STEP_B_POLICY_REOPEN_DESIGN) and openDraftTurn: the open draft as it
 * was before the change the turn asked for, then the claim checked against the
 * form read again — a reply never claims a field the write did not change.
 * (`path` names the caller, "reopen" or "open_draft".) openDraftTurn's write
 * itself is the revision's, in the protected `chat-revision.ts`, until 2b
 * swaps it for `writeRevisionEdits`.
 */
export async function editSnapshot(instanceId: string, path: FormEditPath): Promise<FormSnapshot | null> {
  void path;
  const loaded = await loadInstance(instanceId);
  return loaded ? snapshotOf(loaded) : null;
}

export async function realizedClaim(answer: AskResponse, instanceId: string, before: FormSnapshot | null): Promise<AskResponse> {
  if (!before) return answer;
  const loaded = await loadInstance(instanceId);
  return loaded ? checkedClaim(answer, before, snapshotOf(loaded)) : answer;
}

/**
 * ============================================================================
 * THE REVISION'S WRITE (2b; NOT WIRED — chat-revision.ts is protected)
 * ============================================================================
 *
 * What `applyAssistantRevision(instanceId, draft, cleared, actor)` returns,
 * through the one writer with the revision preset: protected values checked
 * on every rewrite, all or nothing. A refusal writes nothing and reports every
 * key as rejected, so the revision's reply claims none.
 */
export async function writeRevisionEdits(
  instanceId: string,
  draft: Partial<DraftValues>,
  cleared: readonly string[],
  context: { readonly actorId: string; readonly latest: string; readonly notes?: string; readonly named?: readonly string[] },
): Promise<{ accepted: DraftValues; cleared: string[]; rejected: { key: string; reason: string }[] }> {
  const ops: FormEditOp[] = [
    ...opsFrom({ values: draft.values ?? {}, checked: draft.checked ?? {} }),
    ...cleared.map((field) => ({ op: "clear" as const, field })),
  ];
  const result = await writeFormEdits(instanceId, ops, {
    path: "revision",
    actorId: context.actorId,
    latest: context.latest,
    ...(context.notes !== undefined ? { notes: context.notes } : {}),
    ...(context.named ? { named: context.named } : {}),
  });
  return { accepted: result.saved.accepted, cleared: result.saved.cleared, rejected: result.saved.rejected };
}

/* -------------------------------- the old writers' shapes, through here ---- */

type PathContext = Omit<FormEditRules, "actorId">;

/** What `applyAssistantDraft(instanceId, draft, actor, provenance)` returns, through the one writer. */
export async function draftWrite(
  instanceId: string,
  draft: Partial<DraftValues>,
  actorId: string,
  provenance: Readonly<Record<string, Record<string, unknown>>>,
  context: PathContext,
  extra: Partial<Pick<FormEditOp, "derived" | "by">> = {},
): Promise<{ accepted: DraftValues; rejected: { key: string; reason: string }[]; policyRefused: string[]; result: FormWriteResult }> {
  const result = await writeFormEdits(instanceId, opsFrom({ values: draft.values ?? {}, checked: draft.checked ?? {} }, extra, provenance), { ...context, actorId });
  return { accepted: result.saved.accepted, rejected: result.saved.rejected, policyRefused: result.saved.policyRefused, result };
}

/** What `applyStatedFacts(instanceId, stated, actor, allowedKeys)` returns, through the one writer (path "stated"). */
export async function statedWrite(
  instanceId: string,
  stated: DraftValues,
  actorId: string,
  allowedKeys: ReadonlySet<string> | undefined,
  context: Omit<PathContext, "path"> = {},
): Promise<string[]> {
  // As `applyStatedFacts` writes them: only into an empty line. A filled line is kept, not refused.
  const loaded = context.loaded ?? (await loadInstance(instanceId));
  if (!loaded || loaded.instance.status !== "draft") return [];
  const filled = new Set(
    loaded.values.filter((row) => (row.value ?? "").trim() !== "" || row.checked.length > 0).map((row) => row.fieldKey),
  );
  /*
   * And only the lines this form has, as `selectStatedFacts` keeps them: the
   * employment change reader states a Demotion's facts and a Transfer's alike
   * (`transfer_type` on a Demotion Form), and a key the form lacks would refuse
   * the whole write as `unknown_field` — every stated fact lost (step 2b: found
   * once the harness tests read the saved form with the flag on).
   */
  const has = keysOf(loaded);
  const keep = (key: string) => !filled.has(key) && has.has(key);
  const empty: DraftValues = {
    values: Object.fromEntries(Object.entries(stated.values).filter(([key]) => keep(key))),
    checked: Object.fromEntries(Object.entries(stated.checked).filter(([key]) => keep(key))),
  };
  if (Object.keys(empty.values).length + Object.keys(empty.checked).length === 0) return [];
  const result = await writeFormEdits(instanceId, opsFrom(empty, { derived: true, by: "statement" }), {
    ...context,
    loaded,
    path: "stated",
    actorId,
    statedKeys: allowedKeys ?? null,
  });
  return result.saved.statedKeys;
}

/** What `applyAssistantRevision(instanceId, {}, cleared, actor)` returns for a clear, through the one writer. */
export async function clearWrite(
  instanceId: string,
  cleared: readonly string[],
  actorId: string,
  context: PathContext,
): Promise<{ accepted: DraftValues; cleared: string[]; rejected: { key: string; reason: string }[] }> {
  const result = await writeFormEdits(
    instanceId,
    cleared.map((field) => ({ op: "clear" as const, field, derived: true, by: "assistant_revision" as const })),
    { ...context, actorId },
  );
  return { accepted: result.saved.accepted, cleared: result.saved.cleared, rejected: result.saved.rejected };
}

/**
 * A chat correction's save through the one writer (#410's wrapper), path
 * "correction". `stated`: the readers' values from the manager's statement,
 * through the reducer. `passThrough`: what the caller derived from them (a
 * paragraph that follows its field, a withdrawn answer's clear), saved with
 * them as the manager's. `assistant`: what the caller rewrote in a paragraph
 * Ask Sunny drafted (a moved date), saved as the assistant's with its
 * provenance. Returns what `saveInstanceValues` returns, plus
 * `nothingChanged` when every value was already there, the plan's keys and
 * the assistant keys written.
 */
export async function correctionWrite(input: {
  readonly instanceId: string;
  readonly loaded: LoadedInstance;
  readonly stated: { readonly values: Readonly<Record<string, string>>; readonly checked: Readonly<Record<string, readonly string[]>> };
  readonly passThrough?: { readonly values: Readonly<Record<string, string>>; readonly checked?: Readonly<Record<string, readonly string[]>> };
  readonly assistant?: { readonly values: Readonly<Record<string, string>>; readonly provenance: Readonly<Record<string, Record<string, unknown>>> };
  readonly actorId: string;
  /** The manager's statement the readers read. */
  readonly said: string;
  readonly today: string;
  readonly readerValues?: readonly string[];
  readonly employeeColumn?: string | null;
  readonly syncPlan?: FormEditRules["syncPlan"];
}): Promise<{
  rejected: { key: string; reason: string }[];
  values: Record<string, string>;
  nothingChanged?: string;
  planKeys: string[];
  assistantKeys: string[];
  result: FormWriteResult;
}> {
  const ops: FormEditOp[] = [
    ...opsFrom(input.stated),
    ...opsFrom({ values: input.passThrough?.values ?? {}, checked: input.passThrough?.checked ?? {} }, { derived: true, by: "manager" }),
    ...opsFrom({ values: input.assistant?.values ?? {}, checked: {} }, { derived: true, by: "assistant_draft" }, input.assistant?.provenance ?? {}),
  ];
  const result = await writeFormEdits(input.instanceId, ops, {
    path: "correction",
    actorId: input.actorId,
    latest: input.said,
    today: input.today,
    loaded: input.loaded,
    readerValues: input.readerValues ?? [],
    ...(input.employeeColumn ? { employeeColumn: input.employeeColumn } : {}),
    ...(input.syncPlan ? { syncPlan: input.syncPlan } : {}),
  });
  const assistantKeys = Object.keys(input.assistant?.values ?? {}).filter((key) => key in result.saved.accepted.values);
  // A key the write did not change is "unchanged", so the reply never names it.
  const written = new Set([...Object.keys(result.saved.accepted.values), ...Object.keys(result.saved.accepted.checked), ...result.saved.cleared]);
  const rejected =
    result.handoff === null
      ? [
          ...result.saved.rejected,
          ...[...new Set(ops.map((op) => op.field))].filter((key) => !written.has(key)).map((key) => ({ key, reason: "unchanged" })),
        ]
      : result.saved.rejected;
  return {
    rejected,
    values: result.saved.accepted.values,
    ...(result.saved.nothingChanged ? { nothingChanged: result.saved.nothingChanged } : {}),
    planKeys: result.saved.planKeys,
    assistantKeys,
    result,
  };
}
