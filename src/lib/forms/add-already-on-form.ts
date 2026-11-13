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

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);
}

/** Whether a plain add's every content word is already on the saved form. Pure. */
export function addAlreadyOnForm(ask: string, employeeName: string | null, stored: readonly string[]): boolean {
  if (!ADD_ASK.test(ask)) return false;
  const name = new Set(words(employeeName ?? ""));
  const content = words(ask).filter((word) => !COMMAND_WORDS.has(word) && !name.has(word));
  if (content.length === 0) return false;
  const form = new Set(stored.flatMap((value) => words(value)));
  return content.every((word) => form.has(word));
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
