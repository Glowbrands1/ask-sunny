import "server-only";

import type { AskResponse } from "@/lib/ai/types";
import {
  editPolicyAskEnabled,
  formEditSingleWriterEnabled,
  formPatchReaderFixesEnabled,
  stepBMakeItAboutAccountEnabled,
  madeAboutAllOrNothingEnabled,
  madeAboutReaderAccountEnabled,
  madeAboutUndatedTogetherEnabled,
  madeAboutPolicyLineEnabled,
  madeAboutRewriteFinishesEnabled,
  stepBDateSaidEnabled,
  stepBDateWithAboutEnabled,
} from "@/lib/config/chat-quality-flags";
import { madeAbout } from "@/lib/ai/make-it-about";
import { saidFormDate } from "./form-date-said";
import { splitAppCitationLine } from "./app-citation-line";
import { endMadeAboutWrite, madeAboutDate, madeAboutTopic, noteMadeAboutWrite } from "./made-about-date";
import { syncCorrectiveActionPlan } from "./ca-action-plan-sync";
import { checkboxGroupsForVariant, fieldsForVariant, parseFormDocument } from "./document";
import { replyFromDiff } from "./form-diff-reply";
import { readFormPatch, type FormPatchReading } from "./form-patch-model";
import type { FormPatchField, FormPatchInput, FormPatchReadOnly, FormPatchTurn } from "./form-patch-prompt";
import { MANAGER_STATED_KEYS, statedDates, templateRules } from "./form-reducer-draft";
import {
  applyPatch,
  draftFromRows,
  fold,
  type FieldValue,
  type PatchRules,
} from "./form-reducer";
import { formLabels, snapshotDiff, snapshotOf } from "./form-snapshot";
import { authorizeInstance } from "./instance-scope";
import { applyAssistantRevision, applyStatedFacts, loadInstance, saveInstanceValues } from "./instances";
import { NO_PRIOR_ACTION, PRIOR_ACTIONS_KEY } from "./prior-actions";
import { draftableCheckboxGroups, draftableFields } from "./responsibility";
import type { ChatMessage } from "@/types";

/** STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED: the fields that give a form's account (Coaching Details, a CA's Observation). */
const ACCOUNT_KEYS = ["coaching_details", "observation"] as const;
/** The Coaching Form's Other line, written beside its "other" box (MADE_ABOUT_ALL_OR_NOTHING_ENABLED). */
const OTHER_TOPIC_KEY = "other_topic";

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
 * FORM_PATCH_READER_FIXES_ENABLED (QA's trace, bub-phone r1): the prompt shows a field's lines joined by " / "
 * (`buildFormPatchUserMessage`); a value the model returns in that shape, for a field that holds lines, gets its
 * lines back.
 */
function relined(value: FieldValue, current: FieldValue | undefined): FieldValue {
  if (typeof value !== "string" || typeof current !== "string" || !current.includes("\n") || !value.includes(" / ")) return value;
  return value.split(" / ").join("\n");
}

/**
 * FORM_PATCH_READER_FIXES_ENABLED: every value the reader set is already what the form says. One honest line,
 * no `formUpdate`, never "Updated".
 */
/** EDIT_POLICY_ASK_ENABLED: the reply also says what happened to "please list the policy". */
function withPolicySentence(response: AskResponse, outcome: { readonly sentence: string } | null): AskResponse {
  return outcome ? { ...response, content: `${response.content.trimEnd()}\n\n${outcome.sentence}` } : response;
}

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
  // MADE_ABOUT_REWRITE_FINISHES_ENABLED: the form as it was, once the made-about revision has rewritten its account.
  let rewroteFrom: { readonly loaded: Parameters<typeof snapshotOf>[0]; readonly labels: Readonly<Record<string, string>> } | null = null;
  // The fields this turn means to write after the rewrite (the reader's or the topic's, and the Date): said when not saved.
  let intended: readonly string[] = [];
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
    let reading = await readingFor(input, modelInput);
    /*
     * FORM_PATCH_READER_FIXES_ENABLED: a hand-off after a reading tells the old path's revision what the reader saw —
     * "nothing to write" (an empty reading: the revision may not add nothing new), and the evidence of ops it
     * refused (the revision's new content there keeps it). A model fallback tells it nothing.
     */
    const handOff = async (found: "nothing" | "refused" | "none"): Promise<null> => {
      noteMadeAboutExit(input, `handoff:${found}`, rewroteFrom !== null);
      const read = reading;
      if (readerFixes && found !== "none" && "ok" in read) {
        const evidence = Object.fromEntries(
          Object.entries(read.patch.evidence ?? {}).filter(([key, quote]) => key in read.patch.set && fold(input.question).includes(fold(quote))),
        );
        (await import("./reader-found-nothing")).noteReaderFoundNothing(input.instanceId, evidence, found === "nothing");
      }
      return null;
    };
    /*
     * MADE_ABOUT_ALL_OR_NOTHING_ENABLED (QA's live round-7 test, 9 Nov 2026): "make it about leaving the front desk
     * unattended on 11/6/26" with no reading of this form (the reader timed out, or read another form) went to the old
     * path, whose revision rewrote Details alone: Other and the Date stayed. A made-about incident with its own date is
     * read here from the manager's words: the topic (Other, its box ticked) and, below, the Date and the account.
     */
    if ((!("ok" in reading) || reading.turn !== "this_form") && (madeAboutAllOrNothingEnabled() || madeAboutUndatedTogetherEnabled())) {
      reading = madeAboutReading(input, before, writable, allGroups) ?? reading;
    }
    if (!("ok" in reading) || reading.turn !== "this_form") return handOff("none");
    /*
     * MADE_ABOUT_READER_ACCOUNT_ENABLED (ported from Ask Bubbles: QA's live round-9 test there, 9 Nov 2026; the person invented): "make it about
     * leaving the front desk unattended on 11/6/26" on a saved Coaching draft about the missed meeting on 10/10/26 changed
     * Other and Details, and the Date stayed 2026-10-10. The reader set Details itself ("add": the new incident under the
     * old one), so the turn never took the made-about path that writes the Date: "Changed Details of Coaching … Changed
     * Other …". A dated made-about incident is a new account: the reader's own edit of the account is set aside, and the
     * account is rewritten by the old path's revision with the Date and the topic, all or nothing (below).
     */
    const readerSet = reading.patch.set;
    if (
      madeAboutReaderAccountEnabled() &&
      madeAbout(input.question) !== null &&
      /*
       * MADE_ABOUT_REWRITE_FINISHES_ENABLED (QA's live round-13 test, turn 2: "make it about showing up late"): an undated
       * made-about turn whose reader rewrote Details was refused for the old account's date and handed to the old path
       * ("I haven't changed …"). With MADE_ABOUT_UNDATED_TOGETHER it is set aside the same way: the account and the topic
       * are rewritten together, and the Date stays.
       */
      ((madeAboutDate(input.question, input.today) !== null && "form_date" in before) ||
        (madeAboutRewriteFinishesEnabled() && madeAboutUndatedTogetherEnabled())) &&
      ACCOUNT_KEYS.some((key) => key in readerSet)
    ) {
      const drop = new Set<string>(ACCOUNT_KEYS);
      const keep = <T,>(record: Readonly<Record<string, T>> | undefined) =>
        record ? Object.fromEntries(Object.entries(record).filter(([key]) => !drop.has(key))) : undefined;
      reading = {
        ...reading,
        patch: {
          ...reading.patch,
          set: keep(reading.patch.set) ?? {},
          ...(reading.patch.how ? { how: keep(reading.patch.how) } : {}),
          ...(reading.patch.evidence ? { evidence: keep(reading.patch.evidence) } : {}),
        },
      };
    }
    /*
     * STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED (QA's live draft test, 8 Nov 2026): "I need you to make it about showing up
     * late" was read as the Other topic alone, and Details of Coaching stayed about the missed meeting. A turn that
     * says what the form is about, whose patch does not set the form's account, goes to the old path before anything
     * is written: EDIT_MAKE_IT_ABOUT's revision rewrites the account there.
     */
    // STEP_B_DATE_SAID_ENABLED: the date the manager says the form takes (read before the make-it-about guard below).
    const saidDate = stepBDateSaidEnabled() ? saidFormDate(input.question, input.today) : null;
    let dateToWrite = saidDate !== null && "form_date" in before && before.form_date?.value !== saidDate ? saidDate : null;
    const readSet = reading.patch.set;
    const aboutNotRewritten =
      stepBMakeItAboutAccountEnabled() &&
      madeAbout(input.question) !== null &&
      ACCOUNT_KEYS.some((key) => writable.has(key)) &&
      !ACCOUNT_KEYS.some((key) => key in readSet);
    /*
     * STEP_B_DATE_WITH_ABOUT_ENABLED (the Bubbles round-5 gate, 8 Nov 2026; QA's ruling, option A): with both flags on,
     * "I need you to make it about showing up late and please list the policy make the date for 10/14/26" was handed to
     * the old path, and the Date stayed 10/10. A turn that also says the form's date stays here: the reader's edits and
     * the date are written, and the reply says plainly that the account field was kept (below).
     */
    const keepsAccount = aboutNotRewritten && dateToWrite !== null && stepBDateWithAboutEnabled();
    /*
     * STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED (QA's live round-6 trace, Ask Bubbles, 9 Nov 2026; the person invented): on a
     * saved Coaching draft about the missed meeting on 10/10/26, "make it about leaving the front desk unattended on
     * 11/6/26" was handed to the old path, whose revision wrote the new account and was refused for dropping 10/10/26
     * (the form's Date, a protected value): "I haven't changed the Coaching Form …", Other and the Date left too. A
     * made-about incident with its own date is a new account: it stays here. The old path's revision rewrites the
     * account first, then that date and the reader's edits are written. One reply, from the whole diff; an account not
     * rewritten changes nothing (below).
     */
    const aboutDate = aboutNotRewritten && !keepsAccount ? madeAboutDate(input.question, input.today) : null;
    const datedAbout = aboutDate !== null && "form_date" in before;
    if (datedAbout && before.form_date?.value !== aboutDate) dateToWrite = aboutDate;
    /*
     * MADE_ABOUT_UNDATED_TOGETHER_ENABLED (QA's round-11 gate, 9 Nov 2026): "I need you to make it about showing up late"
     * (no date) rewrote Details of Coaching on the old path and left Other on the old topic ("Missed monthly meeting").
     * An undated made-about turn stays here too: the account first, then the topic with it (the reader's, or read from
     * the manager's words); not rewritten, neither. The Date stays, and the reply says so.
     */
    const undatedAbout = aboutNotRewritten && !keepsAccount && !datedAbout && madeAboutUndatedTogetherEnabled();
    // MADE_ABOUT_REWRITE_FINISHES_ENABLED: a dated turn whose reader set no topic (its Details set aside) takes it from the manager's words too.
    if ((undatedAbout || (datedAbout && madeAboutRewriteFinishesEnabled())) && !(OTHER_TOPIC_KEY in readSet)) {
      const topic = madeAboutReading(input, before, writable, allGroups);
      if (topic && "ok" in topic) reading = { ...reading, patch: { ...reading.patch, set: { ...reading.patch.set, ...topic.patch.set }, evidence: { ...reading.patch.evidence, ...topic.patch.evidence } } };
    }
    const rewritesAccount = datedAbout || undatedAbout;
    if (aboutNotRewritten && !keepsAccount && !rewritesAccount) {
      return handOff("none");
    }
    // STEP_B_DATE_WITH_ABOUT_ENABLED: the account field this turn did not rewrite is named as kept, never left unsaid.
    const keptAccountKey = ACCOUNT_KEYS.find((key) => writable.has(key));
    const withKeptAccount = (response: AskResponse): AskResponse =>
      keepsAccount && keptAccountKey
        ? {
            ...response,
            content: `${response.content.trimEnd()}\n\nI kept **${labels[keptAccountKey] ?? keptAccountKey}** as it was: it is not rewritten to be about ${madeAbout(input.question)}. Tell me what it should say, or say "rewrite it", and I'll change it.`,
          }
        : response;
    // The manager's own statement: through the one writer when it is on, else as a stated fact, as the old path writes it.
    const writeFormDate = async (iso: string): Promise<void> => {
      const fresh = await loadInstance(input.instanceId);
      if (fresh && formEditSingleWriterEnabled()) {
        await (await import("./form-write")).correctionWrite({
          instanceId: input.instanceId,
          loaded: fresh,
          stated: { values: { form_date: iso }, checked: {} },
          actorId: actor.id,
          said: input.question,
          today: input.today,
        });
      } else if (fresh) {
        await applyStatedFacts(input.instanceId, { values: { form_date: iso }, checked: {} }, actor.id, new Set(["form_date"]));
      }
    };
    /*
     * STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED: the account first, by the old path's revision (`reviseActiveForm`,
     * unchanged; its rewrite follows the incident's own date, `form-write.ts`). QA's ruling (9 Nov 2026): the Date,
     * Other and the topic describe the same incident as the account, so they change with it or not at all. An account
     * not rewritten writes nothing, and the reply asks what the account should say. Rewritten, the Date and the
     * reader's edits are written below.
     */
    if (rewritesAccount && keptAccountKey) {
      const coordinate = madeAboutAllOrNothingEnabled();
      if (coordinate) noteMadeAboutWrite(input.instanceId);
      try {
        await (await import("./chat-revision"))
          .reviseActiveForm({ request: input.request, instanceId: input.instanceId, question: input.question, history: input.history, today: input.today })
          .catch(() => null);
      } finally {
        if (coordinate) endMadeAboutWrite(input.instanceId);
      }
      const revised = await loadInstance(input.instanceId);
      const rewritten = revised !== null && snapshotDiff(snapshotOf(loaded), snapshotOf(revised)).some((change) => change.key === keptAccountKey);
      /*
       * MADE_ABOUT_POLICY_LINE_ENABLED (QA's live round-11 test, 9 Nov 2026): the old account's "Policy reference: …" line
       * went with it and none was written for the new one. The account rewritten, its reference is written again from
       * the new account (`made-about-policy-line.ts`), only where the old account carried one.
       */
      const hadLine = typeof before[keptAccountKey]?.value === "string" && splitAppCitationLine(before[keptAccountKey]!.value as string).line !== null;
      const finishes = madeAboutRewriteFinishesEnabled();
      if (rewritten && finishes) rewroteFrom = { loaded, labels };
      if (rewritten && hadLine && madeAboutPolicyLineEnabled()) {
        await (await import("./made-about-policy-line")).rewriteMadeAboutPolicyLine({
          instanceId: input.instanceId,
          actorId: actor.id,
          question: input.question,
          accountKey: keptAccountKey,
          // MADE_ABOUT_REWRITE_FINISHES_ENABLED: the old account's line, kept by the revision, is replaced, never left on the new one.
          ...(finishes ? { oldLine: splitAppCitationLine(before[keptAccountKey]!.value as string).line } : {}),
        });
      }
      if (!rewritten) {
        const label = labels[keptAccountKey] ?? keptAccountKey;
        const about = madeAbout(input.question);
        return {
          content: `I haven't changed the **${loaded.instance.templateName}** for **${loaded.instance.employeeName}**: I couldn't rewrite **${label}** to be about ${about}, so ${undatedAbout ? "the topic stays" : "the Date and the topic stay"} as they were too. What should **${label}** say about ${about}?`,
          citations: [],
          coverage: "not_applicable",
          recommendedVideoIds: [],
        };
      }
    }
    /*
     * EDIT_POLICY_ASK_ENABLED (QA's live run, 7 Nov 2026): the latest message asks for the policy on a form whose
     * account field carries the citation line. Answered after the edit is written, below; asked alone ("please list
     * the policy"), it is this turn's whole answer.
     */
    const policyAsk =
      editPolicyAskEnabled() && reading.policyAsked === true && (await import("./edit-policy-ask")).policyAskApplies(loaded.instance.templateKey);
    const answerPolicy = async () =>
      policyAsk ? (await import("./edit-policy-ask")).answerPolicyAsk({ instanceId: input.instanceId, actorId: actor.id, question: input.question }) : null;
    /*
     * QA, 3 Nov 2026 (blocker before the Step B flip; ported from Ask
     * Bubbles): "make it sound more professional" is about this form, but the
     * manager gives nothing to set from their own words. A patch that sets and
     * clears nothing is not this path's turn: null, so the redraft and
     * revision paths run as before. (A patch whose sets were all refused still
     * answers from its diff.)
     */
    /*
     * STEP_B_DATE_SAID_ENABLED (QA's live test, Ask Bubbles production, 8 Nov 2026): "… make the date for 10/14/26"
     * on a saved draft set the topic and the policy, and the Date stayed 10/10 with nothing said: the reader is never
     * offered the form's Date. A date the manager says the form takes (`form-date-said.ts`) is written as their own
     * statement after the reader's edits, and the reply says "Changed Date to …".
     */
    // A date to write goes on below even with no patch (STEP_B_DATE_SAID); the policy is then answered after it.
    if (Object.keys(reading.patch.set).length === 0 && reading.patch.clear.length === 0 && dateToWrite === null) {
      if (!policyAsk) return handOff("nothing");
      const outcome = await answerPolicy();
      if (!outcome) return handOff("nothing");
      const reloadedAlone = await loadInstance(input.instanceId);
      const changedAlone = reloadedAlone ? snapshotDiff(snapshotOf(loaded), snapshotOf(reloadedAlone)) : [];
      return {
        content: outcome.sentence,
        citations: [],
        coverage: "not_applicable",
        recommendedVideoIds: [],
        ...(changedAlone.length > 0 ? { formUpdate: { instanceId: input.instanceId, updated: changedAlone.map((change) => change.key) } } : {}),
      };
    }

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
              formWords: Object.fromEntries(Object.entries(labels).map(([key, label]) => [key, label])),
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
    if (rewroteFrom) intended = [...Object.keys(reading.patch.set), ...(dateToWrite !== null ? ["form_date"] : [])];
    const patchOps = Object.keys(reading.patch.set).length + reading.patch.clear.length;
    let policyOutcome: Awaited<ReturnType<typeof answerPolicy>> = null;
    if (formEditSingleWriterEnabled() && patchOps > 0) {
      const ops = [
        ...Object.entries(reading.patch.set).map(([field, value]) => ({
          op: reading.patch.how?.[field] === "add" ? ("append" as const) : ("set" as const),
          field,
          value: readerFixes ? relined(value, before[field]?.value) : value,
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
      /*
       * MADE_ABOUT_REWRITE_FINISHES_ENABLED (QA's live round-13 test, 9 Nov 2026): the account is already rewritten, so
       * handing off would run the old path's revision a second time and leave Other and the Date. The topic read from the
       * manager's words is written instead (nothing, if that is refused too), and the turn goes on to the Date.
       */
      if (result.handoff === "refused" && rewroteFrom) {
        noteMadeAboutExit(input, "reader_refused_after_rewrite", true);
        const topic = madeAboutReading(input, before, writable, allGroups);
        const topicSet = topic && "ok" in topic ? topic.patch.set : {};
        if (Object.keys(topicSet).length > 0) {
          await (await import("./form-write")).writeFormEdits(
            input.instanceId,
            Object.entries(topicSet).map(([field, value]) => ({
              op: "set" as const,
              field,
              value,
              ...(topic && "ok" in topic && topic.patch.evidence?.[field] !== undefined ? { evidence: topic.patch.evidence[field] } : {}),
            })),
            {
              path: "patch",
              actorId: actor.id,
              latest: input.question,
              managerTurns: managerTurns(input.history, input.question),
              ...(offered !== undefined ? { offered } : {}),
              acceptedOffer: false,
              today: input.today,
              loaded: (await loadInstance(input.instanceId)) ?? loaded,
              writable,
              statedKeys: stated,
              ...(readerFixes ? { readerFixes } : {}),
            },
          );
        }
      } else if (result.handoff === "refused") return handOff("refused");
      /*
       * FORM_PATCH_READER_FIXES_ENABLED (QA's live run, 7 Nov 2026: "yes, do that" after the edit was saved went
       * to the old path, whose revision rewrote the form and said "Updated"): what the reader set is already on
       * the form. Said so; the old path does not run.
       */
      // With a date still to write, the turn goes on: the date is written below, and the policy after it.
      if (readerFixes && result.handoff === "noop" && dateToWrite === null) {
        const outcome = await answerPolicy();
        if (!outcome?.written) return withPolicySentence(alreadyThere(Object.keys(reading.patch.set), labels), outcome);
        policyOutcome = outcome;
      }
    } else if (patchOps > 0) {
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

    if (dateToWrite !== null) await writeFormDate(dateToWrite);
    // EDIT_POLICY_ASK_ENABLED: the policy, after the edit is on the form (its account is what the policy is read from).
    policyOutcome ??= await answerPolicy();
    const reloaded = await loadInstance(input.instanceId);
    if (!reloaded) return null;
    const changed = snapshotDiff(snapshotOf(loaded), snapshotOf(reloaded));
    /* FORM_PATCH_READER_FIXES_ENABLED: the reader's values are already on the form (the old writers' path). */
    if (readerFixes && changed.length === 0) return withKeptAccount(withPolicySentence(alreadyThere(Object.keys(reading.patch.set), labels), policyOutcome));
    // MADE_ABOUT_UNDATED_TOGETHER_ENABLED: no date was said, so the form's Date stays; said, never left unsaid.
    const dateStays = (response: AskResponse): AskResponse => {
      const date = typeof before.form_date?.value === "string" ? before.form_date.value : null;
      if (!undatedAbout || !date || !changed.some((change) => change.key === keptAccountKey)) return response;
      return { ...response, content: `${response.content.trimEnd()}\n\nThe **${labels.form_date ?? "Date"}** stays ${date}; tell me if it should change.` };
    };
    return dateStays(withKeptAccount(withPolicySentence({
      content: replyFromDiff({ changed }, labels),
      citations: [],
      coverage: "not_applicable",
      recommendedVideoIds: [],
      ...(changed.length > 0 ? { formUpdate: { instanceId: input.instanceId, updated: changed.map((change) => change.key) } } : {}),
    }, policyOutcome)));
  } catch (error) {
    noteMadeAboutExit(input, `error:${error instanceof Error ? error.name : typeof error}`, rewroteFrom !== null);
    // MADE_ABOUT_REWRITE_FINISHES_ENABLED: after the rewrite, an error answers from what was saved, never with the old path.
    if (rewroteFrom) return await replyFromSaved(input.instanceId, rewroteFrom, intended).catch(() => null);
    return null;
  }
}

/**
 * MADE_ABOUT_REWRITE_FINISHES_ENABLED (QA, 9 Nov 2026): how a made-about turn left the patch path, in the server log, so
 * the next live miss is visible (the reader's output is not stored). One JSON line; no form text, no names.
 */
function noteMadeAboutExit(input: PatchTurnInput, reason: string, afterRewrite: boolean): void {
  if (!madeAboutRewriteFinishesEnabled() || madeAbout(input.question) === null) return;
  console.info(JSON.stringify({ event: "form_patch.made_about.exit", instanceId: input.instanceId, reason, afterRewrite }));
}

/** MADE_ABOUT_REWRITE_FINISHES_ENABLED: the reply from the saved diff, after the made-about rewrite. */
async function replyFromSaved(
  instanceId: string,
  from: { readonly loaded: Parameters<typeof snapshotOf>[0]; readonly labels: Readonly<Record<string, string>> },
  intended: readonly string[],
): Promise<AskResponse | null> {
  const reloaded = await loadInstance(instanceId);
  if (!reloaded) return null;
  const changed = snapshotDiff(snapshotOf(from.loaded), snapshotOf(reloaded));
  const done = new Set(changed.map((change) => change.key));
  const notSaved = [...new Set(intended)].filter((key) => !done.has(key) && from.labels[key]).map((key) => `**${from.labels[key]}**`);
  const unsaid = notSaved.length > 0 ? `\n\nI couldn't save the change to ${notSaved.join(", ")}: it is as it was. Tell me again and I'll try once more.` : "";
  return {
    content: `${replyFromDiff({ changed }, from.labels)}${unsaid}`,
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
    ...(changed.length > 0 ? { formUpdate: { instanceId, updated: changed.map((change) => change.key) } } : {}),
  };
}

/**
 * MADE_ABOUT_ALL_OR_NOTHING_ENABLED: the reading of a dated made-about turn the reader did not read as this form's — the
 * topic only (the form's "other" box and its Other line, where the draft has both), from the manager's own words; the
 * Date and the account follow (`patchActiveForm`). Null when the turn is not one, or the draft has no Date or account.
 */
function madeAboutReading(
  input: PatchTurnInput,
  before: Readonly<Record<string, { readonly value: unknown }>>,
  writable: ReadonlySet<string>,
  groups: readonly { readonly key: string; readonly options: readonly { readonly key: string }[] }[],
): FormPatchReading | null {
  // MADE_ABOUT_UNDATED_TOGETHER_ENABLED: an undated made-about turn is read the same way (its Date stays).
  const dated = madeAboutDate(input.question, input.today) !== null && "form_date" in before;
  const undated = madeAboutUndatedTogetherEnabled() && madeAbout(input.question) !== null;
  if (!stepBMakeItAboutAccountEnabled() || !(dated || undated)) return null;
  if (!ACCOUNT_KEYS.some((key) => writable.has(key))) return null;
  const topic = madeAboutTopic(input.question, input.today);
  const box = groups.find((group) => writable.has(group.key) && group.options.some((option) => option.key === "other"));
  const set: Record<string, string | string[]> = {};
  const evidence: Record<string, string> = {};
  if (topic && box && writable.has(OTHER_TOPIC_KEY)) {
    set[OTHER_TOPIC_KEY] = topic;
    set[box.key] = ["other"];
    evidence[OTHER_TOPIC_KEY] = topic.toLowerCase();
    evidence[box.key] = topic.toLowerCase();
  }
  return { ok: true, turn: "this_form", patch: { set, clear: [], evidence } };
}
