import { employeeFirstName } from "./employee-reference";

/**
 * ============================================================================
 * A LOOP CARD'S COACHING WRITE-UP: WHAT WAS SEEN, ABOUT THE EMPLOYEE, NO TYPE NOBODY NAMED
 * ============================================================================
 *
 * Pau via QA (20 Nov 2026, item 14; the live Test Testy coaching draft). Create from a loop coaching card saved:
 *   - Observed "Coaching was provided to <name> on greeting guests at the door": the form's own act, not what was seen.
 *   - Expectation "Guests are expected to be greeted at the door …": about guests, not the employee.
 *   - Type of Coaching "Training Plan of Action" ticked, though the manager named no type.
 *
 * On a loop card's Create, for the Coaching and Follow-up Coaching forms:
 *   - An Observed that describes the coaching itself is the card's account (its "What happened:" line, which the loop
 *     checked against the manager's words).
 *   - An Expectation that does not start with the employee's first name is read from the Going Forward the draft wrote
 *     ("<First> will greet …" → "<First> is expected to greet …"). With no such line it is left as written.
 *   - A Type of Coaching box stays ticked only when the manager's words hold its label ("training plan of action").
 *     These are the form's own option labels, not a new word list.
 * Pure.
 */

const SECTION = /(?:^|\n)[ \t]*(Observed|Expectation|Going Forward):[ \t]*\n?/gi;
/** The form's own act ("Coaching was provided …", "Remy was coached …"): never what was seen. */
const THE_COACHING_ITSELF = /\bcoach(?:ing|ed)?\b/i;

interface Section {
  label: string | null;
  body: string;
}

function sections(text: string): Section[] {
  const out: Section[] = [];
  let at = 0;
  let label: string | null = null;
  for (const match of text.matchAll(SECTION)) {
    out.push({ label, body: text.slice(at, match.index) });
    label = match[1]!.replace(/^./, (c) => c.toUpperCase());
    at = match.index! + match[0].length;
  }
  out.push({ label, body: text.slice(at) });
  return out.filter((section) => section.label !== null || section.body.trim() !== "");
}

function rebuilt(parts: Section[]): string {
  return parts.map((part) => (part.label ? `${part.label}:\n${part.body.trim()}` : part.body.trim())).join("\n\n");
}

function words(text: string): string {
  return ` ${(text.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(" ")} `;
}

export interface LoopCoachingInput {
  readonly values: Record<string, string>;
  readonly checked: Record<string, string[]>;
}

export function loopCoachingWriteUp<T extends LoopCoachingInput>(
  draft: T,
  options: {
    readonly detailsKey: string | undefined;
    readonly notes: string;
    readonly employeeName: string | null | undefined;
    readonly typeOptions: readonly { key: string; label: string }[];
    /** The details as drafted, before the guards: where the Going Forward is read when a guard took it off. */
    readonly drafted?: string;
  },
): T {
  let values = draft.values;
  let checked = draft.checked;
  const details = options.detailsKey ? (values[options.detailsKey] ?? "") : "";
  if (options.detailsKey && details.trim() !== "") {
    const parts = sections(details);
    const account = /^What happened:\s*(.+)$/im.exec(options.notes)?.[1]?.trim() ?? "";
    const observed = parts.find((part) => part.label === "Observed");
    if (observed && THE_COACHING_ITSELF.test(observed.body) && account.length >= 10) observed.body = account;
    const first = employeeFirstName(options.employeeName ?? null);
    const expectation = parts.find((part) => part.label === "Expectation");
    if (first && expectation && !new RegExp(`^${first}\\b`, "i").test(expectation.body.trim())) {
      const goingForward =
        parts.find((part) => part.label === "Going Forward")?.body ??
        sections(options.drafted ?? "").find((part) => part.label === "Going Forward")?.body ??
        "";
      const will = new RegExp(`(?:^|[.!?]\\s+)${first}\\s+will\\s+([^.!?]+[.!?]?)`, "i").exec(goingForward.trim())?.[1];
      if (will) expectation.body = `${first} is expected to ${will.trim().replace(/[^.!?]$/, "$&.")}`;
    }
    const text = rebuilt(parts);
    if (text !== details.trim()) values = { ...values, [options.detailsKey]: text };
  }
  const ticked = checked.coaching_type ?? [];
  if (ticked.length > 0) {
    const said = words(options.notes);
    const kept = ticked.filter((key) => {
      const label = options.typeOptions.find((option) => option.key === key)?.label ?? "";
      return label !== "" && said.includes(words(label));
    });
    if (kept.length !== ticked.length) {
      checked = { ...checked };
      if (kept.length > 0) checked.coaching_type = kept;
      else delete checked.coaching_type;
    }
  }
  return values === draft.values && checked === draft.checked ? draft : { ...draft, values, checked };
}
