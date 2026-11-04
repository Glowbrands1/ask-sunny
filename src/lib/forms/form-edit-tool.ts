import "server-only";

import { editFormSchema, editFormTool } from "@/lib/ai/form-tool-schema";
import type { AskResponse, FormEditToolTurn } from "@/lib/ai/types";
import { formEditNoopGuardEnabled, formEditSingleWriterEnabled } from "@/lib/config/chat-quality-flags";
import type { AccessScope, ChatMessage } from "@/types";

import { checkboxGroupsForVariant, fieldsForVariant, parseFormDocument } from "./document";
import { NOTHING_CHANGED, UNCHANGED_FORM_REPLY, replyFromDiff, updatedLines } from "./form-diff-reply";
import { MANAGER_STATED_KEYS, templateRules } from "./form-reducer-draft";
import { draftFromRows, type FieldValue } from "./form-reducer";
import { formLabels } from "./form-snapshot";
import { authorizeInstance } from "./instance-scope";
import { draftableCheckboxGroups, draftableFields } from "./responsibility";

/**
 * ============================================================================
 * THE EDIT TOOL IN THE MAIN CALL (FORM_EDIT_TOOL_IN_STREAM_ENABLED, STEP 3)
 * ============================================================================
 *
 * Design of 4 Nov 2026; ported from Ask Bubbles (c5534279), the mechanism.
 * With a draft form open and a turn that is not a
 * question, a correction or a policy change, the chat route asks the ordinary
 * answering call — the one `server-ask.ts` makes anyway — with one tool
 * offered, `edit_form` (`tool_choice: auto`), and one extra DATA block before
 * the question: the open form as JSON and the caller's scoped staff (name,
 * position and salon, as the directory has them). The
 * system prompt is unchanged.
 *
 *   - The model calls the tool: its ops go through `writeFormEdits` (path
 *     "tool": all or nothing, protected values and dropped words refused), the
 *     form is read again, and the reply is the saved diff (`replyFromDiff`).
 *     The model's text is never shown beside a tool edit (Pau, Q5).
 *   - It does not, or the write is refused or changes nothing: the turn goes
 *     on to the old chain (redraft → same-form copy → revision), and if none
 *     of them answers, the main call's text is the answer — or, when the tool
 *     was called and wrote nothing, "I didn't change anything on the form."
 *
 * ONE MODEL CALL: no tool result goes back, there is no second call. The
 * trace (`slots.form_edit`) holds keys and reasons only, never form text.
 *
 * Loaded only by the chat route's guarded `await import()`; `form-write` only
 * by the guarded import below. No regular expression and no phrase list here:
 * whether the turn is a question is the existing reading (`readQuestion` in
 * `question-not-form.ts`): an ask to act ("can you change …?") is an edit.
 */

const DATA_HEADING = "OPEN FORM DATA";
/** At most this many staff in the DATA block. */
const STAFF_MAX = 200;
/** The staff list never holds the turn up longer than this. */
const STAFF_WAIT_MS = 1_500;

export type FormEditOfferReason =
  | "draft_open"
  | "question"
  | "not_draft"
  | "not_visible"
  | "blank_corrective_action"
  | "no_writable_fields"
  | "error";

export type FormEditHandoff = null | "not_called" | "invalid_input" | "refused" | "noop" | "error";

export interface FormEditTrace {
  offered: boolean;
  offer_reason: FormEditOfferReason | "no_main_call";
  /** Which branch of the question gate decided the turn (`readQuestion`). */
  gate: string | null;
  called: boolean;
  op_kinds: string[];
  fields: string[];
  applied: string[];
  refused: { key: string; reason: string }[];
  handoff: FormEditHandoff;
  ms: number | null;
}

interface StaffEntry {
  readonly name: string;
  readonly position: string | null;
  readonly salon: string | null;
}

export interface FormEditToolSession {
  /** What the answering path reads (`AskRequest.formEditTool`). */
  readonly turn: FormEditToolTurn;
  /** The reply from the saved diff when the tool's edit was written; null otherwise. */
  readonly edited: () => AskResponse | null;
  /** The tool was called and wrote nothing (refused, no change, a bad input). */
  readonly calledWithoutEdit: () => boolean;
}

function emptyTrace(reason: FormEditOfferReason, gate: string | null): FormEditTrace {
  return { offered: false, offer_reason: reason, gate, called: false, op_kinds: [], fields: [], applied: [], refused: [], handoff: null, ms: null };
}

/** A session with no offer: the trace says why. */
function notOffered(reason: FormEditOfferReason, gate: string | null = null): FormEditToolSession {
  const trace = emptyTrace(reason, gate);
  return {
    turn: { offer: null, trace: trace as unknown as Record<string, unknown>, sent: () => {}, apply: async () => {}, failed: () => {} },
    edited: () => null,
    calledWithoutEdit: () => false,
  };
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

/** The caller's scoped staff: name, position and salon, as the directory has them. */
async function scopedStaff(scope: AccessScope | null): Promise<StaffEntry[]> {
  const read = (async (): Promise<StaffEntry[]> => {
    const roster = await import("./employee-roster");
    const facts = await roster.readDirectoryFacts(scope).catch(() => []);
    const people =
      facts.length > 0
        ? facts.map((person) => ({ person, position: person.title, salon: person.primaryLocationName }))
        : // This app's roster rows carry no position: the directory facts above are where it is read.
          (await roster.loadScopedRoster(scope).catch(() => [])).map((person) => ({ person, position: null, salon: null }));
    return people.slice(0, STAFF_MAX).map(({ person, position, salon }) => ({
      name: `${person.preferredFirstName?.trim() || person.firstName} ${person.lastName}`.trim(),
      position: position ?? null,
      salon: salon ?? null,
    }));
  })();
  return Promise.race([read, new Promise<StaffEntry[]>((resolve) => setTimeout(() => resolve([]), STAFF_WAIT_MS))]);
}

/**
 * The turn's `edit_form` session. Not offered (trace only) for a question, a
 * form that is not a draft or not visible to the caller, a Corrective Action
 * Form the assistant has written nothing on (the cited redraft drafts it
 * whole, as the patch turn leaves it), or a form with no writable field.
 */
export async function prepareFormEditTool(input: {
  readonly request: Request;
  readonly instanceId: string;
  readonly question: string;
  readonly history: Pick<ChatMessage, "id" | "role" | "content" | "error">[];
  /** The business day, YYYY-MM-DD. */
  readonly today: string;
  /** The existing question reading (`readQuestion`, QUESTION_NOT_FORM's) and the branch that decided it. */
  readonly gate: { readonly question: boolean; readonly branch: string };
  readonly scope: AccessScope | null;
}): Promise<FormEditToolSession> {
  if (input.gate.question) return notOffered("question", input.gate.branch);
  try {
    let authorized: Awaited<ReturnType<typeof authorizeInstance>>;
    try {
      authorized = await authorizeInstance(input.request, input.instanceId, "edit");
    } catch {
      return notOffered("not_visible", input.gate.branch);
    }
    const { actor, loaded } = authorized;
    if (loaded.instance.status !== "draft") return notOffered("not_draft", input.gate.branch);

    const document = parseFormDocument(loaded.version.document);
    const variantKey = loaded.instance.variantKey;
    const aiFields = draftableFields(document, variantKey);
    const aiGroups = draftableCheckboxGroups(document, variantKey);
    const corrective = aiFields.some((field) => field.key === "policy_language") && aiGroups.some((group) => group.key === "offense_type");
    const assistantWrote = loaded.values.some((row) => row.filledBy === "ai" && ((row.value ?? "").trim() !== "" || row.checked.length > 0));
    if (corrective && !assistantWrote) return notOffered("blank_corrective_action", input.gate.branch);

    const template = templateRules(loaded);
    const allFields = fieldsForVariant(document, variantKey);
    const allGroups = checkboxGroupsForVariant(document, variantKey);
    const stated = new Set([...allFields.map((field) => field.key), ...allGroups.map((group) => group.key)].filter((key) => MANAGER_STATED_KEYS.has(key)));
    const writable = new Set([...template.writable, ...stated]);
    const labels = formLabels(loaded);
    const before = draftFromRows(loaded.values);

    const fields: { key: string; label: string; value: FieldValue; filled_by: string; options?: string[] }[] = [];
    for (const field of allFields) {
      if (!writable.has(field.key)) continue;
      fields.push({ key: field.key, label: labels[field.key] ?? field.key, value: before[field.key]?.value ?? "", filled_by: before[field.key]?.owner ?? "empty" });
    }
    for (const group of allGroups) {
      if (!writable.has(group.key)) continue;
      fields.push({
        key: group.key,
        label: labels[group.key] ?? group.key,
        value: before[group.key]?.value ?? [],
        filled_by: before[group.key]?.owner ?? "empty",
        options: group.options.map((option) => option.key),
      });
    }
    const keys = fields.map((field) => field.key);
    if (keys.length === 0) return notOffered("no_writable_fields", input.gate.branch);

    const staff = await scopedStaff(input.scope);
    const data = `${DATA_HEADING}\n\n${JSON.stringify({
      open_form: { template: loaded.instance.templateName, employee: loaded.instance.employeeName || null, fields },
      staff,
    })}`;
    const tool = editFormTool(keys as [string, ...string[]]);
    const schema = editFormSchema(keys as [string, ...string[]]);

    const trace = emptyTrace("draft_open", input.gate.branch);
    trace.offer_reason = "no_main_call";
    let edited: AskResponse | null = null;
    let calledWithoutEdit = false;

    const apply = async (raw: unknown): Promise<void> => {
      const started = Date.now();
      trace.called = true;
      try {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          trace.handoff = "invalid_input";
          calledWithoutEdit = true;
          return;
        }
        const ops = parsed.data.ops;
        trace.op_kinds = ops.map((op) => op.op);
        trace.fields = ops.map((op) => op.field);
        const writer = formEditSingleWriterEnabled() ? await import("./form-write") : null;
        if (!writer) {
          trace.handoff = "error";
          calledWithoutEdit = true;
          return;
        }
        const offered = lastAssistant(input.history);
        const result = await writer.writeFormEdits(
          input.instanceId,
          ops.map((op) => (op.op === "clear" ? { op: "clear" as const, field: op.field } : { op: op.op, field: op.field, value: op.value })),
          {
            path: "tool",
            actorId: actor.id,
            latest: input.question,
            managerTurns: managerTurns(input.history, input.question),
            ...(offered !== undefined ? { offered } : {}),
            // A tool op carries no evidence: its words are the latest message's, never the assistant's offer.
            acceptedOffer: false,
            today: input.today,
            loaded,
            writable,
            statedKeys: stated,
            syncPlan: { after: [...stated], amountSentence: true, notes: input.question },
          },
        );
        trace.refused = result.refused.map((refusal) => ({ key: refusal.key, reason: refusal.reason }));
        if (result.handoff !== null || result.changed.length === 0) {
          trace.handoff = result.handoff ?? "noop";
          calledWithoutEdit = true;
          return;
        }
        trace.applied = result.changed.map((change) => change.key);
        edited = {
          // FORM_EDIT_NOOP_GUARD_ENABLED (Step 4): "Updated: <label>: <value>" per saved change.
          content: formEditNoopGuardEnabled()
            ? updatedLines(result.changed, labels, (await import("./form-noop-reply")).optionLabelsOf(loaded))
            : replyFromDiff({ changed: result.changed }, labels),
          citations: [],
          coverage: "not_applicable",
          recommendedVideoIds: [],
          formUpdate: { instanceId: input.instanceId, updated: result.changed.map((change) => change.key) },
        };
      } catch {
        trace.handoff = "error";
        calledWithoutEdit = true;
      } finally {
        trace.ms = Date.now() - started;
      }
    };

    return {
      turn: {
        offer: { tool, data },
        trace: trace as unknown as Record<string, unknown>,
        sent: () => {
          trace.offered = true;
          trace.offer_reason = "draft_open";
          trace.handoff = "not_called";
        },
        apply: async (raw) => {
          if (trace.called) return;
          trace.handoff = null;
          await apply(raw);
        },
        // Classification fix (this app, 4 Nov 2026): a failed main call hands the turn to the old chain.
        failed: () => {
          if (trace.called) return;
          trace.handoff = "error";
        },
      },
      edited: () => edited,
      calledWithoutEdit: () => calledWithoutEdit,
    };
  } catch {
    return notOffered("error");
  }
}

/** The tool was called and wrote nothing, and no old path answered: said plainly, never "Updated". */
export function nothingChangedAnswer(): AskResponse {
  // FORM_EDIT_NOOP_GUARD_ENABLED (Step 4): the plain reply says what to do next.
  return { content: formEditNoopGuardEnabled() ? UNCHANGED_FORM_REPLY : NOTHING_CHANGED, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}
