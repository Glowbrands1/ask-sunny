import { employeeFirstName } from "./employee-reference";

/**
 * ============================================================================
 * THE EXPECTATION IS FILLED, IN ITS PLACE, AND THE NAME IS THE FIRST NAME (QA's live test of #1154, 20 Nov 2026; f075)
 * ============================================================================
 *
 * "ca for <P>, not in dress code, no name tag and no goal sheet" (a card citing two headings) saved "Observed: <First>
 * was not in dress code … Expectation: [EMPTY] Going Forward: <First> should arrive … <P> is expected to comply with the
 * current Sun Tan City requirements…": the drafter left the Expectation empty, put its sentence under Going Forward, and
 * switched to the full name. On a loop card's write-up (the app's own drafted text, never the manager's words):
 *   - the employee's full name becomes the first name, as the rest of the write-up calls them;
 *   - an Expectation that is empty or missing takes the "<First> is expected to …" sentence written under another
 *     heading (never Observed), moved, not copied;
 *   - with none, it is built from Going Forward's "<First> will / should X" as "<First> is expected to X" (that
 *     sentence stays where it is);
 *   - a Going Forward left with nothing is dropped.
 * A write-up with no Observed/Expectation shape, or an Expectation already filled, keeps its sections. Pure.
 */

type Label = "Observed" | "Expectation" | "Going Forward";
interface Section {
  label: Label | null;
  body: string;
}

const HEADING = /^\s*(Observed|Expectations?|Going Forward)\s*:\s*(.*)$/i;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);

function labelOf(raw: string): Label {
  const lower = raw.toLowerCase();
  return lower.startsWith("expectation") ? "Expectation" : lower === "going forward" ? "Going Forward" : "Observed";
}

function parse(text: string): Section[] {
  const sections: Section[] = [{ label: null, body: "" }];
  for (const line of text.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) sections.push({ label: labelOf(heading[1]!), body: heading[2]!.trim() });
    else sections[sections.length - 1]!.body = `${sections[sections.length - 1]!.body}\n${line}`.trim();
  }
  return sections.filter((section) => section.label !== null || section.body !== "");
}

const render = (sections: readonly Section[]) => sections.map((section) => (section.label ? `${section.label}:\n${section.body}` : section.body)).join("\n\n").trim();

/** The write-up with the first name throughout and a filled Expectation; `changed` when anything moved. */
export function loopWriteUpSections(text: string, employeeName: string | null): { text: string; changed: boolean } {
  const first = employeeFirstName(employeeName);
  const full = (employeeName ?? "").trim();
  if (!first || text.trim() === "") return { text, changed: false };
  /* The full name (with any middle part) becomes the first name. */
  let named = text;
  if (full.split(/\s+/).length > 1) named = named.replace(new RegExp(`\\b${full.split(/\s+/).map(escape).join("\\s+")}\\b`, "gi"), first);

  const sections = parse(named);
  if (!sections.some((section) => section.label === "Observed")) return { text: named, changed: named !== text };
  const expected = new RegExp(`^${escape(first)}\\s+is\\s+expected\\s+to\\b`, "i");
  let expectation = sections.find((section) => section.label === "Expectation");
  let moved = false;
  if (!expectation || expectation.body === "") {
    let sentence: string | null = null;
    /* Moved: an expectation sentence written under another heading (never the account under Observed). */
    for (const section of sections) {
      if (section.label === "Observed" || section.label === "Expectation" || section.label === null) continue;
      const found = sentencesOf(section.body).find((candidate) => expected.test(candidate));
      if (found) {
        sentence = found;
        section.body = sentencesOf(section.body).filter((candidate) => candidate !== found).join(" ");
        break;
      }
    }
    /* Built: Going Forward's "<First> will / should X" as "<First> is expected to X". */
    if (!sentence) {
      const forward = sections.find((section) => section.label === "Going Forward");
      const plan = forward ? sentencesOf(forward.body).map((candidate) => new RegExp(`^${escape(first)}\\s+(?:will|should)\\s+(.+)$`, "i").exec(candidate)?.[1]).find(Boolean) : undefined;
      if (plan) sentence = `${first} is expected to ${plan}`;
    }
    if (sentence) {
      if (!expectation) {
        expectation = { label: "Expectation", body: "" };
        sections.splice(sections.findIndex((section) => section.label === "Observed") + 1, 0, expectation);
      }
      expectation.body = sentence;
      moved = true;
    }
  }
  /* Only a moved or built Expectation re-lays the sections; otherwise the drafter's layout is kept as written. */
  if (!moved) return { text: named, changed: named !== text };
  const kept = sections.filter((section) => !(section.label === "Going Forward" && section.body === ""));
  const next = render(kept);
  return { text: next, changed: next !== text };
}
