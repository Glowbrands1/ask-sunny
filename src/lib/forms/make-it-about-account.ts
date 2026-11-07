/**
 * ============================================================================
 * "MAKE IT ABOUT <X>": THE ACCOUNT IS ABOUT <X> ALONE
 * ============================================================================
 *
 * STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED (QA's live AI checks, 8 Nov 2026). On a saved Coaching draft about a missed
 * monthly meeting, "I need you to make it about showing up late" was written as "Observed: <A> showed up late to the
 * monthly meeting on 10/10/26": X merged into the old event, a fact nobody said (she missed the meeting; she did not
 * arrive late to it). When the manager says what the form is about, the account becomes X; nothing of the earlier
 * account's event survives in it.
 *
 * The earlier event is read from the account's own words: the content words of its Observed part, less the
 * employee's name, dates and X's own words. The new account keeps the form's outline (Observed:, Expectation:,
 * Going Forward:). Its Observed part is the reader's text when that holds none of the old event's words, otherwise
 * X in the manager's own words. Any other part that still speaks of the old event is left empty for the manager.
 *
 * Pure: the caller decides when the flag applies.
 */

const HEADING = /^\s*(Observed|Observation|Expectations?|Going Forward|Plan|Follow[- ]?up)\s*:\s*(.*)$/i;
const STOP = new Set([
  "that", "this", "with", "from", "have", "been", "were", "will", "would", "should", "could", "their", "there", "they",
  "them", "then", "than", "when", "what", "which", "while", "also", "into", "onto", "over", "very", "just", "each",
  "every", "after", "before", "about", "being", "employee", "today", "observed", "expected", "expectation",
]);

interface Section {
  readonly heading: string | null;
  readonly body: string;
}

function sectionsOf(text: string): Section[] {
  const out: { heading: string | null; lines: string[] }[] = [];
  for (const line of (text ?? "").split("\n")) {
    const match = HEADING.exec(line);
    if (match) {
      out.push({ heading: match[1]!, lines: match[2] ? [match[2]] : [] });
      continue;
    }
    if (out.length === 0) out.push({ heading: null, lines: [] });
    out[out.length - 1]!.lines.push(line);
  }
  return out.map((section) => ({ heading: section.heading, body: section.lines.join("\n").trim() }));
}

function words(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !/^\d+$/.test(word) && !STOP.has(word))
    .map((word) => word.replace(/(?:ings|ing|ed|es|s)$/, ""));
}

function isObserved(heading: string | null): boolean {
  return heading !== null && /^observ/i.test(heading);
}

/** The earlier account's event words: its Observed part (or all of it), less the name and X's own words. */
export function oldEventWords(current: string, about: string, employeeName: string | null): Set<string> {
  const sections = sectionsOf(current);
  const observed = sections.find((section) => isObserved(section.heading))?.body ?? (sections.every((section) => section.heading === null) ? current : "");
  const skip = new Set([...words(about), ...words(employeeName ?? "")]);
  return new Set(words(observed).filter((word) => !skip.has(word)));
}

function speaksOf(text: string, event: ReadonlySet<string>): boolean {
  return words(text).some((word) => event.has(word));
}

/** True when the proposed account still carries the earlier account's event. */
export function blendsOldEvent(proposed: string, current: string, about: string, employeeName: string | null): boolean {
  const event = oldEventWords(current, about, employeeName);
  if (event.size === 0) return false;
  const observed = sectionsOf(proposed).find((section) => isObserved(section.heading))?.body ?? proposed;
  return speaksOf(observed, event);
}

function asSentence(about: string): string {
  const text = about.charAt(0).toUpperCase() + about.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * The account after "make it about <X>": the form's outline kept, its Observed part about X alone, and nothing of the
 * earlier event left in any part.
 */
/** The dates the earlier account's Observed part gives, as written. */
const WRITTEN_DATE = /\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g;

function observedOf(text: string): string {
  const sections = sectionsOf(text);
  return sections.find((section) => isObserved(section.heading))?.body ?? (sections.every((section) => section.heading === null) ? text : "");
}

/** X, with the name and dates the earlier account held (a draft's write keeps them): "<Name> — showing up late (10/10/26)." */
function aboutWithFacts(about: string, current: string, employeeName: string | null): string {
  const observed = observedOf(current);
  const named = employeeName && observed.toLowerCase().includes(employeeName.toLowerCase()) ? employeeName : null;
  const dates = [...new Set(observed.match(WRITTEN_DATE) ?? [])];
  const said = `${named ? `${named} — ` : ""}${named ? about : about.charAt(0).toUpperCase() + about.slice(1)}`;
  return `${said}${dates.length > 0 ? ` (${dates.join(", ")})` : ""}.`;
}

export function accountMadeAbout(input: {
  about: string;
  current: string;
  proposed: string | null;
  employeeName: string | null;
  /** The one writer's draft paths keep every protected value (name, dates) the earlier account held. */
  keepFacts?: boolean;
}): string {
  const event = oldEventWords(input.current, input.about, input.employeeName);
  const base = sectionsOf(input.proposed ?? input.current);
  const outline = base.some((section) => section.heading !== null) ? base : sectionsOf(input.current);
  if (!outline.some((section) => section.heading !== null)) {
    const proposed = (input.proposed ?? "").trim();
    const own = input.keepFacts ? aboutWithFacts(input.about, input.current, input.employeeName) : asSentence(input.about);
    return proposed && !speaksOf(proposed, event) && speaksOf(proposed, new Set(words(input.about))) ? proposed : own;
  }
  const proposedObserved = input.proposed ? sectionsOf(input.proposed).find((section) => isObserved(section.heading))?.body ?? "" : "";
  const aboutWords = new Set(words(input.about));
  const own = input.keepFacts ? aboutWithFacts(input.about, input.current, input.employeeName) : asSentence(input.about);
  const observedBody = proposedObserved && !speaksOf(proposedObserved, event) && speaksOf(proposedObserved, aboutWords) ? proposedObserved : own;
  const parts = outline
    .filter((section) => section.heading !== null || section.body !== "")
    .map((section) => {
      if (isObserved(section.heading)) return `${section.heading}:\n${observedBody}`;
      const body = speaksOf(section.body, event) ? "" : section.body;
      return section.heading ? `${section.heading}:${body ? `\n${body}` : ""}` : body;
    })
    .filter(Boolean);
  if (!outline.some((section) => isObserved(section.heading))) parts.unshift(`Observed:\n${observedBody}`);
  return parts.join("\n\n");
}
