// Copied from the Leadership Hub (src/lib/assistant/chat-mentions.ts); keep in step with it. See src/features/l10/README.md.
/**
 * @-mentions in the Leadership Assistant's chat box. Picking a person writes their exact full name after "@"
 * ("@Avery Quill"), which the assistant's note card matches to exactly that account (a full-name match wins), so a
 * picked person is never guessed. Pure helpers: the picker hook and the message bubbles use them.
 */
import type { Person } from "@/features/l10/lib/mentions";

export type { Person };

/** Replaces the "@query" being typed with "@Full Name " and says where the caret goes. */
export function insertMention(text: string, trigger: { start: number; query: string }, name: string): { text: string; caret: number } {
  const end = trigger.start + 1 + trigger.query.length;
  const inserted = `@${name} `;
  const rest = text.slice(end).replace(/^ /, "");
  return { text: `${text.slice(0, trigger.start)}${inserted}${rest}`, caret: trigger.start + inserted.length };
}

export type ChatSegment = { type: "text"; text: string } | { type: "person"; name: string };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits a message into text and "@Full Name" of known people (longest names first), for name chips in the bubble. */
export function splitChatMentions(text: string, people: readonly Person[]): ChatSegment[] {
  const names = [...new Set(people.map((p) => p.name.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!names.length || !text.includes("@")) return [{ type: "text", text }];
  const re = new RegExp(`(^|[^\\p{L}\\p{N}@])@(${names.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "gu");
  const out: ChatSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index + m[1].length;
    if (at > last) out.push({ type: "text", text: text.slice(last, at) });
    out.push({ type: "person", name: m[2] });
    last = at + 1 + m[2].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}
