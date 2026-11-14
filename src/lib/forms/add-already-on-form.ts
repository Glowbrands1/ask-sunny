import "server-only";

import { addAlreadyOnFormSaysSoEnabled } from "@/lib/config/chat-quality-flags";
import type { AskResponse } from "@/lib/ai/types";

/**
 * ADD_ALREADY_ON_FORM_SAYS_SO_ENABLED (coding 6; ported from the sibling app: QA's live 17u test there, item 5, 13 Nov 2026):
 * "add that she was on the phone for the entire shift" on a CA draft that already said it got the old path's generic
 * "I haven't changed the Corrective Action Form … everything on it is as it was." A plain add ("add that …", "include
 * …") that changed nothing, and whose every content word is on the saved form, already says that: the reply says so.
 * Anything else keeps the revision's own reply. The protected revision (`chat-revision.ts`) is not touched: this reads
 * its reply and the stored form after it.
 */

/** The revision's generic "nothing changed" reply. */
const NOTHING_CHANGED = /^\s*I haven'?t changed the \*\*[^*]+\*\*[^\n]*?—\s*everything on it is as it was\./;
/** A plain addition: "add that …", "include …", "also note …". */
const ADD_ASK = /^\s*(?:please\s+)?(?:can\s+you\s+)?(?:also\s+)?(?:add|include|note|mention|insert)\b/i;
/** Words of an ask that name the edit, not its content. */
const COMMAND_WORDS = new Set([
  "add", "also", "include", "note", "mention", "insert", "please", "can", "could", "you", "that", "this", "the", "and",
  "she", "her", "hers", "his", "him", "they", "them", "their", "was", "were", "has", "have", "had", "for", "with", "from",
  "into", "onto", "about", "form", "too", "there", "here", "line", "field", "section", "observation", "details",
]);

/** Contractions read as their two words, so a negation is matched in place ("wasn't" is "was not"). */
const CONTRACTIONS: readonly [RegExp, string][] = [
  [/\b(\w+)n['’]t\b/gi, "$1 not"],
  [/\bcan not\b/gi, "cannot"],
];
/** The few words read as the same (the gate's "the whole shift" / "the entire shift"). Kept small on purpose. */
const SAME: Readonly<Record<string, string>> = { whole: "entire" };
/**
 * Filler words skipped on both sides before the in-order match (Gate-Sunny-3, 13 Nov 2026: "on the phone the whole
 * shift" against "on the phone for the entire shift"). Never a negation, a verb or a content word.
 */
const FILLER: ReadonlySet<string> = new Set(["the", "a", "an", "her", "his", "their", "for", "of"]);
/** The lead of a plain add, up to its content ("add that ", "please also include "). */
const ADD_LEAD = /^\s*(?:please\s+)?(?:can\s+you\s+)?(?:also\s+)?(?:add|include|note|mention|insert)\b\s*(?:that\s+|in\s+that\s+)?/i;

function tokens(text: string): string[] {
  let plain = text.toLowerCase();
  for (const [pattern, replacement] of CONTRACTIONS) plain = plain.replace(pattern, replacement);
  return plain
    .replace(/[’']/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "")
    .map((word) => SAME[word] ?? word)
    .filter((word) => !FILLER.has(word));
}

/**
 * Whether a plain add is already on the saved form: its words, after the lead and the subject ("she", "he", "they" or
 * the employee's name), stand on the form IN ORDER, as one phrase. A negation must match in place: "add that she was
 * NOT on the phone …" is not on a form that says she was on the phone (Gate-Bubbles-4 on #871). Pure.
 */
export function addAlreadyOnForm(ask: string, employeeName: string | null, stored: readonly string[]): boolean {
  if (!ADD_ASK.test(ask)) return false;
  let said = tokens(ask.replace(ADD_LEAD, ""));
  const name = tokens(employeeName ?? "");
  if (["she", "he", "they"].includes(said[0] ?? "")) said = said.slice(1);
  else if (name.length > 0 && name.includes(said[0] ?? "")) said = said.slice(said.slice(0, name.length).filter((word) => name.includes(word)).length);
  if (said.filter((word) => !COMMAND_WORDS.has(word)).length === 0) return false;
  const phrase = ` ${said.join(" ")} `;
  return stored.some((value) => ` ${tokens(value).join(" ")} `.includes(phrase));
}

/** The reply, when the revision changed nothing and the add is already on the saved form; null otherwise. */
export async function alreadyOnFormReply(
  request: Request,
  instanceId: string,
  ask: string,
  reply: AskResponse | null,
): Promise<AskResponse | null> {
  if (!addAlreadyOnFormSaysSoEnabled() || !reply || !NOTHING_CHANGED.test(reply.content)) return null;
  try {
    const { authorizeInstance } = await import("./instance-scope");
    const { loaded } = await authorizeInstance(request, instanceId, "view");
    if (loaded.instance.status !== "draft") return null;
    const stored = loaded.values.flatMap((row) => [row.value ?? "", ...(row.checked ?? [])]);
    if (!addAlreadyOnForm(ask, loaded.instance.employeeName || null, stored)) return null;
    const who = loaded.instance.employeeName ? ` for **${loaded.instance.employeeName}**` : "";
    return {
      ...reply,
      content: `The **${loaded.instance.templateName}**${who} already says that: I checked the saved form, and nothing on it needed to change. Give it a read below.`,
    };
  } catch {
    return null;
  }
}
