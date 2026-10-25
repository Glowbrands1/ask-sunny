import { keepFormEmployeeEnabled, notANameGuardEnabled } from "@/lib/config/chat-quality-flags";
import { isNotAName } from "@/lib/forms/not-a-name";
import { typedEmployeeName } from "@/lib/forms/typed-employee-name";

import type { AskResponse } from "./types";

/**
 * ============================================================================
 * THE CARD KEEPS THE NAME THE MANAGER TYPED (KEEP_FORM_EMPLOYEE_ENABLED)
 * ============================================================================
 *
 * QA, 25 Oct 2026: "Create an exit form for Test Employee at Lawrence, she
 * resigned …" put **Test** on the card. The proposal's sentence reader
 * (forms/proposal.ts) ends a capitalised name at a form word, and "Employee"
 * is one ("Employee Performance Plan"), so it reads "Test". On the intent
 * path the typed name reaches the card through the stored employee line and
 * the slot keeper (`holdFilledSlots`); with intent extraction off nothing
 * carries it, so the card is set here, last.
 *
 * Only when the manager's words type "<First> Employee" as the person (see
 * `typedEmployeeName`) and the card's employee is exactly that first word:
 * the card and the reply's bold name lines then carry the full name. A card
 * for anybody else, a lower-case "an employee", and flag off: unchanged.
 */
export function withTypedEmployeeOnCard(
  response: AskResponse,
  managerText: string,
  /** The manager's earlier turns, oldest first. Read with NOT_A_NAME_GUARD_ENABLED only. */
  earlierTurns: readonly string[] = [],
): AskResponse {
  const guarded = withGuardedTypedEmployee(response, managerText, earlierTurns);
  if (guarded) return guarded;
  const proposal = response.formProposal;
  if (!keepFormEmployeeEnabled() || !proposal?.employeeName) return response;
  const typed = typedEmployeeName(managerText);
  if (!typed) return response;
  const first = typed.split(" ")[0]!;
  const shown = proposal.employeeName.trim();
  if (shown.toLowerCase() !== first.toLowerCase()) return response;
  const escaped = shown.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const content = response.content
    // "for **Test**", "**Test**'s"
    .replace(new RegExp(`\\*\\*${escaped}\\*\\*`, "g"), `**${typed}**`)
    // "**Name:** Test", "**Employee:** Test" at the end of the line or before a comma.
    .replace(
      new RegExp(`(\\*\\*(?:Employee(?: name)?|Name):\\*\\*\\s*)${escaped}(?=\\s*(?:$|[,.;(]))`, "gim"),
      `$1${typed}`,
    );
  return { ...response, content, formProposal: { ...proposal, employeeName: typed } };
}
/**
 * ============================================================================
 * NOT_A_NAME_GUARD_ENABLED: "TEST EMPLOYEE" ON THE PROPOSAL FLOW (QA, 25 OCT 2026)
 * ============================================================================
 *
 * Ported from Ask Bubbles (QA B4, B8, G11 there). The proposal's name reader
 * cannot read "Test Employee" ("Employee" names a form), so the card took
 * what was left: **Test** (and still **Test** after "verbal"), and here, with
 * CA_TEMPLATE_MAP / FORM_CHOICE_STATED on, "Ne" from "… at Kearney, NE." or
 * nobody ("Who is this for?").
 *
 * With the guard on, the name the manager typed (`typedEmployeeName`, in this
 * turn or the newest earlier turn that typed one) goes on a card whose
 * employee is that name's first word, is missing, or is not a person; a line
 * asking who the form is for then becomes the line that names them. A card
 * for anybody else, and any card but a Corrective Action or coaching one
 * (`GUARDED_TEMPLATES`), is left alone. Off, unchanged.
 */
/**
 * The Corrective Action and coaching cards QA found this on. The exit form and
 * the other forms keep their own readers (the sibling app's exit intake pin,
 * with its EXIT_INTAKE_FIX_ENABLED off, had this guard answer its "Which of
 * them is this …?" for it).
 */
const GUARDED_TEMPLATES: ReadonlySet<string> = new Set(["dpoa", "coaching", "follow-up-coaching", "policy-review"]);

function withGuardedTypedEmployee(
  response: AskResponse,
  managerText: string,
  earlierTurns: readonly string[],
): AskResponse | null {
  const proposal = response.formProposal;
  if (!notANameGuardEnabled() || !proposal || !GUARDED_TEMPLATES.has(proposal.templateKey)) return null;
  const typed = [managerText, ...[...earlierTurns].reverse()].map(typedEmployeeName).find(Boolean) ?? null;
  if (!typed) return null;
  const first = typed.split(" ")[0]!.toLowerCase();
  const shown = proposal.employeeName?.trim() ?? "";
  if (shown && shown.toLowerCase() !== first && !isNotAName(shown)) return null;
  if (shown.toLowerCase() === typed.toLowerCase()) return null;
  const escaped = shown.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lead = `I'll draft a **${proposal.templateName}** for **${typed}** from what you've described.`;
  let content = renumbered(
    response.content
      .split("\n")
      .map((line) => (/^(?:Which of them is this|Who is this)\b/.test(line.trim()) ? lead : line))
      // The intake list's "1. The employee's full name …" is answered.
      .filter((line) => !/^\s*\d+\.\s+(?:the\s+)?employee's full name\b/i.test(line)),
  ).join("\n");
  if (shown) {
    content = content
      .replace(new RegExp(`\\*\\*${escaped}\\*\\*`, "g"), `**${typed}**`)
      .replace(new RegExp(`(\\*\\*(?:Employee(?: name)?|Name):\\*\\*\\s*)${escaped}(?=\\s*(?:$|[,.;(]))`, "gim"), `$1${typed}`);
  }
  return { ...response, content, formProposal: { ...proposal, employeeName: typed } };
}

/** A numbered list counted again from 1 after an item came out. */
function renumbered(lines: readonly string[]): string[] {
  let next = 0;
  return lines.map((line) => {
    const item = /^(\s*)\d+\.(\s+)/.exec(line);
    if (!item) {
      if (line.trim() !== "") next = 0;
      return line;
    }
    next += 1;
    return `${item[1]}${next}.${item[2]}${line.slice(item[0].length)}`;
  });
}
