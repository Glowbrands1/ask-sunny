import { employeeFirstName } from "./employee-reference";

/**
 * ============================================================================
 * A MISSED SHIFT IS WRITTEN UP AS AN ABSENCE (QA's production audit, 20 Nov 2026; item 21)
 * ============================================================================
 *
 * A real finalized form: the manager typed "did not come into her scheduled shift today at 9:30", and the saved
 * write-up said "Expectation: <P> is expected to arrive on time and be ready to work at the start of the scheduled
 * shift". The write-up names the offense the manager described. When the loop card's record says the offense is an
 * absence (`attendanceKind`, kept on the manager's quoted words), a sentence of the DRAFTED write-up that speaks of
 * lateness is not the offense:
 *   - under Expectation it becomes "<First> is expected to come in for every scheduled shift.";
 *   - under Going Forward, "<First> will come in for every scheduled shift.";
 *   - anywhere else (Observed) it is dropped, and an Observed left empty is the card's own account.
 * This reads the app's own drafted text, never the manager's messages: which offense it is comes from the card's
 * record. Pure.
 */

/** Lateness, as the drafter writes it. */
const LATENESS_SENTENCE = /\b(?:late|lateness|tardy|tardiness|on[- ]time|punctual\w*|arriv(?:e|es|ed|ing|al))\b/i;
const HEADING = /^\s*(observed|expectations?|going forward)\s*:\s*(.*)$/i;

type Section = "observed" | "expectation" | "going forward" | null;

function sectionOf(heading: string): Section {
  const lower = heading.toLowerCase();
  if (lower.startsWith("expectation")) return "expectation";
  if (lower === "going forward") return "going forward";
  return "observed";
}

function rewriteText(text: string, section: Section, first: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim() !== "");
  let replaced = false;
  const kept = sentences.flatMap((sentence) => {
    if (!LATENESS_SENTENCE.test(sentence)) return [sentence];
    if (section === "expectation" || section === "going forward") {
      if (replaced) return [];
      replaced = true;
      return [section === "expectation" ? `${first} is expected to come in for every scheduled shift.` : `${first} will come in for every scheduled shift.`];
    }
    return [];
  });
  return kept.join(" ");
}

/** The write-up of a card whose offense is an absence, with no sentence calling it lateness. */
export function absenceWriteUp(
  values: Readonly<Record<string, string>>,
  keys: readonly string[],
  options: { employeeName: string | null; cardAccount: string | null },
): { values: Record<string, string>; changed: boolean } {
  const first = employeeFirstName(options.employeeName ?? "") ?? "The employee";
  const out: Record<string, string> = { ...values };
  let changed = false;
  for (const key of keys) {
    const value = values[key];
    if (typeof value !== "string" || !LATENESS_SENTENCE.test(value)) continue;
    let section: Section = null;
    const lines = value.split("\n").map((line) => {
      const heading = HEADING.exec(line);
      if (heading) {
        section = sectionOf(heading[1]!);
        const rest = heading[2]!.trim();
        return rest === "" ? line : `${line.slice(0, line.indexOf(":") + 1)} ${rewriteText(rest, section, first)}`.trimEnd();
      }
      return line.trim() === "" ? line : rewriteText(line, section, first);
    });
    /* A section left with no sentence: Observed is the card's own account; any other heading goes with it. */
    const filled: string[] = [];
    for (let at = 0; at < lines.length; at += 1) {
      const line = lines[at]!;
      filled.push(line);
      const heading = HEADING.exec(line);
      if (!heading || heading[2]!.trim() !== "") continue;
      const next = lines.slice(at + 1).find((later) => later.trim() !== "");
      if (next !== undefined && !HEADING.exec(next)) continue;
      if (sectionOf(heading[1]!) === "observed" && options.cardAccount?.trim()) filled.push(options.cardAccount.trim());
      else filled.pop();
    }
    const next = filled.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (next !== value) {
      out[key] = next;
      changed = true;
    }
  }
  return { values: out, changed };
}
