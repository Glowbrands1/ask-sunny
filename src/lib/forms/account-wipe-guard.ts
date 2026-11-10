import type { FormPatch } from "./form-reducer";

/*
 * ============================================================================
 * AN EDIT NEVER WIPES THE ACCOUNT UNLESS THE MANAGER ASKS (ACCOUNT_WIPE_GUARD_ENABLED)
 * ============================================================================
 *
 * ported from the sibling app (QA, a manager's 1★ rating there, 5–6 Nov 2026): the manager reopened a previous Coaching Form and typed "this is a
 * verbal warning. previous coaching policy manual 10-15-26"; the edit wiped Details of Coaching. Replayed with production's
 * flags: when the form-patch reader reads that turn as clearing Details, or as replacing them with "This is a verbal
 * warning.", the writer takes it ("Cleared Details of Coaching.") — nothing in the manager's words asks for either.
 *
 * With the flag on, a clear or a full replace of an account field that already holds text (Details of Coaching,
 * Observation of Offense, Follow-Up Observation) is dropped from the patch unless the latest message names that field,
 * asks to remove or rewrite it, makes the form about something ("make it about …"), or corrects it ("fix her last name,
 * it is …"). A replace that keeps the old account (a word corrected inside it) is never dropped. Adds, and any other
 * field, are as before. Pure.
 */

export const ACCOUNT_KEYS: ReadonlySet<string> = new Set(["coaching_details", "observation", "follow_up_observation"]);

/** A removal or rewrite asked in so many words: "remove", "clear", "replace", "rewrite", "start over", "instead of". */
const WIPE_ASKED =
  /\b(?:remove|delete|clear|erase|wipe|blank|empty|take\s+out|get\s+rid\s+of|replace|rewrite|re-?write|redo|re-?do|start\s+over|scrap|swap\s+out|instead\s+of|change\s+(?:it|that|the\s+\w+)\s+to|should\s+(?:say|read)|make\s+it\s+(?:say|read))\b/i;

/** Short names a manager uses for each account field, besides its label. */
const FIELD_WORDS: Readonly<Record<string, RegExp>> = {
  coaching_details: /\b(?:details?|coaching\s+details?)\b/i,
  observation: /\b(?:observation|observed)\b/i,
  follow_up_observation: /\b(?:follow[-\s]?up\s+observation|observation)\b/i,
};

function fold(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The latest message names this field: its label, or the word managers use for it. */
export function namesField(latest: string, key: string, label: string | undefined): boolean {
  if (label && fold(label) && ` ${fold(latest)} `.includes(` ${fold(label)} `)) return true;
  return FIELD_WORDS[key]?.test(latest) ?? false;
}

export function wipeAsked(latest: string): boolean {
  return WIPE_ASKED.test(latest);
}

/*
 * QA's gate (10 Nov 2026): the guard refused edits the manager did ask for — "make it about showing up late …", "can you
 * make it for missing out monthly meeting" (the account rewritten on purpose), "fix her last name, it is Pembrooke" (a
 * correction that rewrites the account), and a replace that keeps the account with one name corrected. Those go through.
 */
/** "make it about …", "make it for …", "make this be about …": the account is rewritten on purpose. */
const MADE_ABOUT = /\bmake\s+(?:it|this|that|the\s+(?:form|document|coaching(?:\s+(?:form|document))?|ca|corrective\s+action(?:\s+form)?|write-?up))\s+(?:be\s+)?(?:about|for)\b/i;
/** "fix her last name, it is …", "it's spelled …", "should be …", "correct the …", "actually …": a correction. */
const CORRECTION = /\b(?:fix|correct(?:ion)?|it\s+is|it's|its\s+spelled|spelled|should\s+be|actually|typo|misspelled|wrong)\b/i;

export function rewriteAsked(latest: string): boolean {
  return MADE_ABOUT.test(latest) || CORRECTION.test(latest);
}

function contentWords(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[\p{L}\d][\p{L}\d'’-]{3,}/gu) ?? [])];
}

/** The new text keeps the old account (at least half its words): a correction inside it, never an account dropped. */
export function keepsAccount(before: string, after: string): boolean {
  const old = contentWords(before);
  if (old.length === 0) return true;
  const kept = new Set(contentWords(after));
  return old.filter((word) => kept.has(word)).length / old.length >= 0.5;
}

/**
 * The patch without the clears and full replaces of account fields the manager did not ask for. `current` is what each
 * field holds now: a field with no text loses nothing, so it is never guarded.
 */
export function withoutUnaskedAccountWipes(
  patch: FormPatch,
  input: { readonly latest: string; readonly labels: Readonly<Record<string, string>>; readonly current: Readonly<Record<string, unknown>> },
): { readonly patch: FormPatch; readonly kept: readonly string[] } {
  const holdsText = (key: string) => {
    const value = input.current[key];
    return typeof value === "string" ? value.trim() !== "" : Array.isArray(value) && value.length > 0;
  };
  const guarded = (key: string) =>
    ACCOUNT_KEYS.has(key) &&
    holdsText(key) &&
    !wipeAsked(input.latest) &&
    !rewriteAsked(input.latest) &&
    !namesField(input.latest, key, input.labels[key]);
  const kept: string[] = [];
  const clear = patch.clear.filter((key) => {
    if (!guarded(key)) return true;
    kept.push(key);
    return false;
  });
  const set = Object.fromEntries(
    Object.entries(patch.set).filter(([key]) => {
      if (patch.how?.[key] !== "replace" || !guarded(key)) return true;
      const before = input.current[key];
      const value = patch.set[key];
      if (typeof before === "string" && typeof value === "string" && keepsAccount(before, value)) return true;
      kept.push(key);
      return false;
    }),
  );
  if (kept.length === 0) return { patch, kept };
  const keep = (record: Readonly<Record<string, string>> | undefined) =>
    record ? Object.fromEntries(Object.entries(record).filter(([key]) => key in set || clear.includes(key))) : undefined;
  return {
    patch: { set, clear, ...(patch.how ? { how: keep(patch.how) as FormPatch["how"] } : {}), ...(patch.evidence ? { evidence: keep(patch.evidence) } : {}) },
    kept,
  };
}
