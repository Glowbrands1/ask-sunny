import { titleEndsAtLineEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * "DISTRICT MANAGER THESSALY BROOKHART" IS HER TITLE, NOT THE EMPLOYEE'S
 * ============================================================================
 *
 * TITLE_OF_THE_EMPLOYEE_ENABLED (port from the sibling app; QA, 5 Nov 2026,
 * R2; default off). A manager told one employee's story and named the
 * district manager twice in passing ("When <employee> spoke with District
 * manager <name> …"); the card's Job title became "District Manager". A title read from the manager's words
 * is the employee's only if it is not attached to somebody else: every place
 * the title is written, a name that is not the employee's stands right next
 * to it (just after it, or just before it).
 *
 * Conservative by construction: a title that is not written out as such (an
 * abbreviation the title reader expands), or that appears once beside no
 * name, is left to the readers as before. PURE: no I/O, no word list — the
 * names are the capitalised words beside the title, checked against the
 * card's employee.
 */
export function titleNamesAnotherPerson(text: string, title: string, employeeName: string | null): boolean {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || !employeeName?.trim()) return false;
  const employee = new Set(employeeName.toLowerCase().split(/\s+/).filter(Boolean));
  const pattern = new RegExp(String.raw`\b${words.map(escape).join(String.raw`\s+`)}\b`, "gi");
  let seen = 0;
  for (const match of text.matchAll(pattern)) {
    seen += 1;
    const at = match.index ?? 0;
    // TITLE_ENDS_AT_LINE_ENABLED (Sunny gate, 6 Nov 2026, s16): the name after a title is on the title's line; the next line ("NE Kearney") is not its owner.
    const after = titleEndsAtLineEnabled() && titleLine(text, at, match[0].length) ? null : nameAt(text.slice(at + match[0].length), "after", titleEndsAtLineEnabled());
    const before = nameAt(text.slice(0, at), "before");
    const beside = [after, before].filter((name): name is string[] => name !== null);
    const other = beside.some((name) => name.every((word) => !employee.has(word.toLowerCase())));
    if (!other) return false;
  }
  return seen > 0;
}

const NAME_WORD = /^\p{Lu}[\p{L}'’-]+$/u;

/**
 * TITLE_ENDS_AT_LINE_ENABLED: the title begins its own line and the rest of that line is only
 * capitalised words ("Team Member Part Time"). That line is a longer title, not a title and a
 * name; its owner is the line before.
 */
function titleLine(text: string, at: number, length: number): boolean {
  const start = text.lastIndexOf("\n", at - 1) + 1;
  if (text.slice(start, at).trim() !== "") return false;
  const end = text.indexOf("\n", at + length);
  const rest = text.slice(at + length, end === -1 ? text.length : end).trim();
  return rest === "" || rest.split(/\s+/).every((word) => NAME_WORD.test(word));
}

/** One to three capitalised words straight after (or before) the title, or null. */
function nameAt(text: string, side: "after" | "before", sameLine = false): string[] | null {
  // sameLine: only what is on the title's own line counts (a line break ends the name).
  const source = sameLine ? (text.match(/^[^\S\n]*([^\n]*)/)?.[1] ?? "") : text;
  const tokens = side === "after" ? source.replace(/^\s+/, "").split(/\s+/) : source.replace(/\s+$/, "").split(/\s+/).reverse();
  const name: string[] = [];
  for (const raw of tokens) {
    const word = raw.replace(/[.,;:!?)("]+$/u, "").replace(/^[("]+/u, "");
    if (!NAME_WORD.test(word)) break;
    name.push(word);
    if (raw !== word || name.length === 3) break;
  }
  return name.length > 0 ? name : null;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
