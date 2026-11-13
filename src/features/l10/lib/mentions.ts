// Copied from the Leadership Hub (src/lib/mentions/mentions.ts); keep in step with it. See src/features/l10/README.md.
/**
 * @-mentions in meeting text.
 *
 * A mention is stored in the document text as `@[Display Name|account-uuid]`, produced only by the picker.
 * The pattern is the same one the database recorder uses, so what the page treats as a mention is exactly what
 * can notify. A name typed by hand is just text. The name inside a token is never trusted: a person's own
 * display name from the meeting's roster is shown instead (an id that is not on the roster stays plain text).
 */
export interface Person {
  id: string;
  name: string;
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const TOKEN_SOURCE = `@\\[([^\\]|\\[]{1,80})\\|(${UUID})\\]`;
const newTokenRe = () => new RegExp(TOKEN_SOURCE, "g");

/** A name that is safe to put inside a token (no brackets or bars, at most 80 characters). */
export function tokenName(name: string): string {
  return name.replace(/[\][|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function makeToken(p: Person): string {
  return `@[${tokenName(p.name)}|${p.id.toLowerCase()}]`;
}

/** Shown for a mention whose account is not on the meeting's roster. */
export const UNKNOWN_PERSON = "Unknown person";

export type Segment = { type: "text"; text: string } | { type: "mention"; name: string; id: string; known: boolean };

/** Splits text into plain parts and mentions. A mention is `known` only when its id is on the roster. */
export function splitMentions(text: string, roster: readonly Person[]): Segment[] {
  const byId = new Map(roster.map((p) => [p.id.toLowerCase(), p.name]));
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(newTokenRe())) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    const id = m[2].toLowerCase();
    const known = byId.get(id);
    // Unknown id: a neutral label, never a chip and never the name written inside the token (that is whatever
    // its author chose, and could imitate a real colleague).
    out.push(known !== undefined ? { type: "mention", name: known, id, known: true } : { type: "mention", name: UNKNOWN_PERSON, id, known: false });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/** The text with every mention as "@Name" (roster name when known), for labels, search and plain output. */
export function mentionsToText(text: string, roster: readonly Person[]): string {
  return splitMentions(text, roster)
    .map((s) => (s.type === "text" ? s.text : `@${s.name}`))
    .join("");
}

/** The account ids that have a token in this text. */
export function tokenIds(text: string): string[] {
  return [...new Set([...text.matchAll(newTokenRe())].map((m) => m[2].toLowerCase()))];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Roster names that are unique (two people with one name cannot be told apart by name, so they stay raw tokens). */
function uniqueByName(roster: readonly Person[]): Map<string, Person> {
  const counts = new Map<string, number>();
  for (const p of roster) counts.set(tokenName(p.name).toLowerCase(), (counts.get(tokenName(p.name).toLowerCase()) ?? 0) + 1);
  return new Map(roster.filter((p) => counts.get(tokenName(p.name).toLowerCase()) === 1 && tokenName(p.name)).map((p) => [p.id.toLowerCase(), p]));
}

/** What an editing field shows: each token of a roster person as "@Name". Other tokens stay as they are. */
export function toDisplay(stored: string, roster: readonly Person[]): string {
  const ok = uniqueByName(roster);
  return stored.replace(newTokenRe(), (whole, _name: string, id: string) => {
    const p = ok.get(id.toLowerCase());
    return p ? `@${tokenName(p.name)}` : whole;
  });
}

/**
 * Back from what the field shows to what is stored. Only people already mentioned in this text (or just picked,
 * `extraIds`) turn back into tokens, so typing a name by hand never creates one.
 */
export function fromDisplay(display: string, previousStored: string, roster: readonly Person[], extraIds: readonly string[] = []): string {
  const ok = uniqueByName(roster);
  const allowed = new Set([...tokenIds(previousStored), ...extraIds.map((i) => i.toLowerCase())]);
  const people = [...ok.values()].filter((p) => allowed.has(p.id.toLowerCase())).sort((a, b) => tokenName(b.name).length - tokenName(a.name).length);
  let out = display;
  for (const p of people) {
    const name = tokenName(p.name);
    // "@Name" at a word boundary on both sides; never inside an existing token (those start with "@[").
    const re = new RegExp(`(^|[^\\p{L}\\p{N}@])@${escapeRe(name)}(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(re, (_w, pre: string) => `${pre}${makeToken(p)}`);
  }
  return out;
}

/** The "@query" being typed just before the caret, if any (a picker trigger). */
export function activeTrigger(display: string, caret: number): { start: number; query: string } | null {
  const before = display.slice(0, caret);
  const m = before.match(/(^|[\s(])@([^\s@[\]|]{0,30})$/u);
  if (!m) return null;
  return { start: before.length - m[2].length - 1, query: m[2] };
}

export function filterPeople(roster: readonly Person[], query: string, limit = 8): Person[] {
  const q = query.trim().toLowerCase();
  const starts = roster.filter((p) => p.name.toLowerCase().startsWith(q) || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)));
  const rest = roster.filter((p) => !starts.includes(p) && p.name.toLowerCase().includes(q));
  return (q ? [...starts, ...rest] : [...roster]).slice(0, limit);
}
