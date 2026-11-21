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

/** The offense a loop card recorded that is not lateness (f082: leaving early is not lateness either). */
export type NotLatenessKind = "absence" | "left_early";

/** The Expectation and Going Forward sentences for each offense, in place of the drafter's lateness ones. */
const STANDARD: Record<NotLatenessKind, { expectation: (first: string) => string; goingForward: (first: string) => string }> = {
  absence: {
    expectation: (first) => `${first} is expected to come in for every scheduled shift.`,
    goingForward: (first) => `${first} will come in for every scheduled shift.`,
  },
  /*
   * f082 (QA's live test, 20 Nov 2026, conv_mwpgp5pq29vc3jk): "ca for <A>, we do not do extra cleaning after hours,
   * she left early 11/18" was written up as lateness ("arrive on time … Continued lateness will result in …"). Leaving
   * before the shift ends is about staying, never about arriving.
   */
  left_early: {
    expectation: (first) => `${first} is expected to stay for the full scheduled shift.`,
    goingForward: (first) => `${first} will stay for the full scheduled shift.`,
  },
};

function rewriteText(text: string, section: Section, first: string, kind: NotLatenessKind = "absence"): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim() !== "");
  let replaced = false;
  const kept = sentences.flatMap((sentence) => {
    if (!LATENESS_SENTENCE.test(sentence)) return [sentence];
    if (section === "expectation" || section === "going forward") {
      if (replaced) return [];
      replaced = true;
      return [section === "expectation" ? STANDARD[kind].expectation(first) : STANDARD[kind].goingForward(first)];
    }
    return [];
  });
  return kept.join(" ");
}

/** The write-up of a card whose offense is an absence or leaving early (`kind`, absence by default), with no sentence calling it lateness. */
export function absenceWriteUp(
  values: Readonly<Record<string, string>>,
  keys: readonly string[],
  options: { employeeName: string | null; cardAccount: string | null; kind?: NotLatenessKind },
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
        return rest === "" ? line : `${line.slice(0, line.indexOf(":") + 1)} ${rewriteText(rest, section, first, options.kind)}`.trimEnd();
      }
      return line.trim() === "" ? line : rewriteText(line, section, first, options.kind);
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
