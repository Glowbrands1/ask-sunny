import { withoutAppLines } from "@/lib/ai/app-sentences";

import { personRosterNames } from "./person-guard";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The roster person a turn names: the whole name in any case, or the first name as a capitalized word. */
function names(turn: string, rosterName: string): boolean {
  const words = rosterName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  if (new RegExp(`\\b${words.map(escape).join("\\s+")}\\b`, "i").test(turn)) return true;
  const first = words[0]!;
  if (first.length < 3) return false;
  const capitalized = first[0]!.toUpperCase() + first.slice(1).toLowerCase();
  return new RegExp(`(?<![\\w'])${escape(capitalized)}(?![\\w'])`).test(turn);
}

/** The employee by any one of their name's words, in any case ("wynne", "Sarrow"). */
function namesTheEmployee(turn: string, employeeName: string): boolean {
  return employeeName
    .split(/\s+/)
    .filter((word) => word.length >= 3)
    .some((word) => new RegExp(`\\b${escape(word)}\\b`, "i").test(turn));
}

/**
 * OBSERVATION_OTHER_PERSON_TURN_ENABLED (Pau via QA, 5 Nov 2026, sf-s22): a
 * reviewer's notes about another employee ("… signed by Corwen …", "Corwen
 * completed 24 tans …"), pasted as a model to follow, went into this
 * employee's Observation of Offense. The turns the account is read from,
 * without any turn that names somebody else on the manager's roster and does
 * not name this employee. A turn that names both stays ("in the format of
 * Tamsyn ca … for wynne sarrow"). No roster (a test, the browser): unchanged.
 */
export function withoutOtherPersonTurns(turns: readonly string[], employeeName: string | null): readonly string[] {
  const roster = personRosterNames();
  if (!employeeName || !roster || roster.length === 0) return turns;
  const employee = employeeName.toLowerCase().split(/\s+/);
  const others = roster.filter((name) => {
    const words = name.toLowerCase().split(/\s+/);
    return !(words[0] === employee[0] && words[words.length - 1] === employee[employee.length - 1]);
  });
  // The manager's own lines: a stored "The employee is …" line ahead of a turn names nobody.
  return turns.filter((turn) => {
    const said = withoutAppLines(turn);
    return namesTheEmployee(said, employeeName) || !others.some((name) => names(said, name));
  });
}
