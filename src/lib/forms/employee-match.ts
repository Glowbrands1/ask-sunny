/**
 * ============================================================================
 * IS THE NAME THE MANAGER TYPED SOMEBODY ON THEIR TEAM?
 * ============================================================================
 *
 * A form's employee has always been free text in the manager's own spelling.
 * Production feedback: "Katlin" was accepted for a Kaitlyn without a word, and
 * the record carries the misspelling for good. Where the employee directory
 * knows who works at the manager's salons, the typed name is checked against
 * THAT LIST ONLY — the roster the caller passes in is already restricted to the
 * actor's own scope, and nothing here can widen it.
 *
 * WHAT IT NEVER DOES:
 *
 *   AUTOCORRECT. A close spelling is a question — "Did you mean Kaitlyn
 *   Smith?" — and the form is not offered until the manager answers it. An
 *   HR record naming the wrong person is worse than one with a typo.
 *
 *   CHOOSE BETWEEN PEOPLE. Two plausible matches are both put to the manager.
 *
 *   NAME SOMEBODY OUTSIDE THE ROSTER IT WAS GIVEN. Every suggestion is a row of
 *   that roster, and "no match" says nothing about who exists elsewhere.
 *
 *   BLOCK A NAME THE DIRECTORY DOES NOT HAVE. A new hire may not have synced
 *   yet; "no match" keeps the typed name and the manager is told so.
 *
 * PURE: no I/O. `employee-roster.ts` loads the scoped roster on the server.
 */

/** One employee the actor may file a form about. */
export interface RosterEmployee {
  /** Directory id — never shown, used only to tell two same-named people apart. */
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredFirstName?: string | null;
  /** Ask Sunny salon ids (`loc-NNNN`) the employee is actively assigned to. */
  readonly salonIds: readonly string[];
}

export type NameMatch =
  /** The typed name is this employee, spelled as the directory spells them. */
  | { kind: "exact"; employee: RosterEmployee; name: string }
  /** Close but not the same, or a lone first name: the manager confirms. */
  | { kind: "confirm"; candidates: { employee: RosterEmployee; name: string }[] }
  /** Nobody on the roster is close. The typed name stands, as typed. */
  | { kind: "none" }
  /** No roster to check against — the directory is empty or unavailable. */
  | { kind: "unchecked" };

/*
 * ============================================================================
 * DIRECTORY ROWS THAT ARE NOT A PERSON
 * ============================================================================
 *
 * The live Woven directory holds shared and service accounts alongside the
 * team — "Risk Management", "No Manager", "GlowBrands IT Support" — and the
 * matcher offered them like anybody else ("Did you mean No Manager?"). Their
 * position is no guide: "No Manager" is listed as a Tanning Consultant.
 *
 * CONSERVATIVE BY CONSTRUCTION. A row is left out only when EVERY word of its
 * name is a word for a department, a role or a system — so "Risk Management"
 * goes and "Kim Keller" cannot, and neither can a real person with one such
 * word in their name ("Hope Office" keeps "Hope"). Nothing is written to the
 * directory; the row is simply never a name suggestion on a form.
 */
const SERVICE_NAME_WORDS = new Set([
  "no", "none", "risk", "management", "manager", "managers", "it", "support", "help", "helpdesk",
  "desk", "admin", "administrator", "account", "accounts", "payroll", "hr", "office", "corporate",
  "franchise", "glowbrands", "glow", "brands", "operations", "ops", "system", "systems", "service",
  "services", "department", "team", "shared", "general", "front", "store", "salon", "test",
  "training", "loss", "prevention",
]);

/** Whether a directory row's name is a department, role or system rather than a person. */
export function isServiceAccountName(firstName: string, lastName: string): boolean {
  const words = `${firstName} ${lastName}`.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.length > 0 && words.every((word) => SERVICE_NAME_WORDS.has(word));
}

/** How many close candidates are ever put to the manager. */
const MAX_SUGGESTIONS = 3;

export function displayName(employee: RosterEmployee): string {
  return `${employee.firstName.trim()} ${employee.lastName.trim()}`.replace(/\s+/g, " ").trim();
}

function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Optimal-string-alignment distance: insertions, deletions, substitutions, adjacent swaps. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * Whether two name WORDS are plausibly the same word mistyped.
 *
 * Tighter for short words: "Ann" and "Dan" are one edit apart and are not a
 * typo of each other. Four letters or fewer allow one edit; longer, two. The
 * first letter must agree for a short word, which is where a different name
 * most often differs.
 */
function closeWord(typed: string, actual: string): boolean {
  if (typed === actual) return true;
  const shorter = Math.min(typed.length, actual.length);
  if (shorter <= 2) return false;
  const limit = shorter <= 4 ? 1 : 2;
  if (shorter <= 4 && typed[0] !== actual[0]) return false;
  return editDistance(typed, actual) <= limit;
}

function firstNames(employee: RosterEmployee): string[] {
  return [employee.firstName, employee.preferredFirstName ?? ""]
    .map(normalize)
    .filter((name) => name.length > 0);
}

/**
 * Checks a typed employee name against the actor's scoped roster.
 *
 *   "Kaitlyn Smith" for Kaitlyn Smith        exact — the directory's spelling
 *   "kaitlyn smith"                          exact
 *   "Katlin Smith" / "Kaitlyn Smoth"         confirm: "Did you mean Kaitlyn Smith?"
 *   "Kaitlyn" with one Kaitlyn                confirm: a first name alone is a
 *                                            question, because the full name is
 *                                            what goes on the record
 *   "Kaitlyn" with two                       confirm, both offered
 *   "Zelda Quinn"                            none — kept as typed
 */
export function matchEmployeeName(typed: string, roster: readonly RosterEmployee[]): NameMatch {
  if (roster.length === 0) return { kind: "unchecked" };
  const words = normalize(typed).split(" ").filter(Boolean);
  if (words.length === 0) return { kind: "none" };

  const typedFirst = words[0]!;
  const typedLast = words.length > 1 ? words[words.length - 1]! : null;

  const exact: RosterEmployee[] = [];
  const close: { employee: RosterEmployee; score: number }[] = [];

  for (const employee of roster) {
    const firsts = firstNames(employee);
    const last = normalize(employee.lastName);
    if (firsts.length === 0) continue;

    if (typedLast === null) {
      if (firsts.includes(typedFirst)) close.push({ employee, score: 0 });
      else if (firsts.some((first) => closeWord(typedFirst, first))) {
        close.push({ employee, score: Math.min(...firsts.map((first) => editDistance(typedFirst, first))) });
      }
      continue;
    }

    /*
     * A FULL NAME. A surname typed as an initial ("Kaitlyn S") is the same
     * person when the initial agrees — the conversation reader treats it so.
     */
    const lastMatches = typedLast.length === 1 ? last.startsWith(typedLast) : last === typedLast;
    if (firsts.includes(typedFirst) && lastMatches) {
      exact.push(employee);
      continue;
    }
    const firstClose = firsts.some((first) => closeWord(typedFirst, first));
    const lastClose = typedLast.length > 1 && closeWord(typedLast, last);
    if (firstClose && (lastMatches || lastClose)) {
      const score =
        Math.min(...firsts.map((first) => editDistance(typedFirst, first))) +
        (typedLast.length > 1 ? editDistance(typedLast, last) : 0);
      close.push({ employee, score });
    }
  }

  if (exact.length === 1 && typedLast !== null && typedLast.length > 1) {
    return { kind: "exact", employee: exact[0]!, name: displayName(exact[0]!) };
  }
  // A surname initial, or two people with the same full name: the manager says which.
  const candidates = exact.length > 0 ? exact.map((employee) => ({ employee, score: 0 })) : close;
  if (candidates.length === 0) return { kind: "none" };

  const ranked = [...candidates]
    .sort((a, b) => a.score - b.score || displayName(a.employee).localeCompare(displayName(b.employee)))
    .slice(0, MAX_SUGGESTIONS);
  return {
    kind: "confirm",
    candidates: ranked.map(({ employee }) => ({ employee, name: displayName(employee) })),
  };
}

/* ------------------------------------------------- asking, and answering --- */

/**
 * The question, in a fixed shape so the next turn can recognise the answer to
 * it. The bolded names are the only thing `readNameConfirmation` reads, and
 * every one of them is re-checked against the roster before it is used.
 */
export function nameConfirmationQuestion(typed: string, candidates: readonly string[]): string {
  if (candidates.length === 1) {
    return `Did you mean **${candidates[0]}**? I couldn't find **${typed}** exactly in the employee list for your salons, so I want to be sure before it goes on the form. Reply "yes" to use **${candidates[0]}**, or "no" to keep **${typed}** as you typed it.`;
  }
  const names = candidates.map((name) => `**${name}**`);
  return `Did you mean ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}? More than one person on your team is a close match for **${typed}**, so tell me which one — or say "keep ${typed}" to use the name exactly as you typed it.`;
}

const ASKED = /^Did you mean ((?:\*\*[^*]+\*\*(?:, | or )?)+)\?/;

const AFFIRMATIVE =
  /^\s*(?:yes|yeah|yep|yup|correct|right|that'?s (?:right|correct|her|him|them|the one)|exactly|y|sure|please do|use (?:that|it))\b[\s.!,]*(?:please|thanks?|thank you)?[\s.!]*$/i;
const NEGATIVE =
  /^\s*(?:no|nope|nah|n|keep (?:it|that|the name)?(?: as (?:i )?typed| as is)?|keep\s+.+|leave it|as typed|that'?s (?:wrong|not (?:her|him|them|it|right)))\b/i;

export type NameConfirmation =
  /** The manager said yes to the single name Sunny suggested. */
  | { kind: "accepted"; name: string }
  /** The manager said keep what they typed. */
  | { kind: "declined" }
  | null;

/**
 * Reads the manager's reply to `nameConfirmationQuestion`, if the turn before
 * it asked one. Only the most recent question counts, and only a bare yes/no
 * answers it — "yes, Kaitlyn Smith" or a different name is an ordinary name
 * the proposal reads the usual way.
 *
 * The suggested name it returns is UNTRUSTED (the history comes from the
 * browser). The caller re-checks it against the scoped roster.
 */
export function readNameConfirmation(
  conversation: readonly { role: string; content: string }[],
): NameConfirmation {
  const turns = conversation.filter((turn) => typeof turn.content === "string");
  const last = turns[turns.length - 1];
  if (!last || last.role !== "user") return null;
  const asked = [...turns.slice(0, -1)].reverse().find((turn) => turn.role === "assistant");
  if (!asked) return null;
  const question = ASKED.exec(asked.content.trim());
  if (!question) return null;
  const names = [...question[1]!.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]!.trim());

  if (AFFIRMATIVE.test(last.content)) {
    return names.length === 1 ? { kind: "accepted", name: names[0]! } : null;
  }
  if (NEGATIVE.test(last.content)) return { kind: "declined" };
  return null;
}

/**
 * Whether a turn is a bare answer to a pending name question — so an open
 * intake continues on "yes" instead of the turn going to retrieval.
 */
export function answersNameConfirmation(
  history: readonly { role: string; content: string }[],
  question: string,
): boolean {
  return readNameConfirmation([...history, { role: "user", content: question }]) !== null;
}

/**
 * Every "Did you mean" exchange the manager settled in this conversation, as
 * typed -> chosen. Used where the conversation is re-read later — the currency
 * check at creation — so a card for "Kaitlyn Smith" is recognised as the
 * answer to "Katlin" rather than refused as a different person.
 */
export function acceptedNameSuggestions(
  conversation: readonly { role: string; content: string }[],
): string[] {
  return settledNameQuestions(conversation).accepted;
}

const TYPED_IN_QUESTION = /(?:couldn't find|a close match for) \*\*([^*]+)\*\*/;

/**
 * Both halves of every settled question: the names accepted, and the typed
 * names the manager said to keep. A kept name is not asked about again.
 */
export function settledNameQuestions(
  conversation: readonly { role: string; content: string }[],
): { accepted: string[]; kept: string[] } {
  const accepted: string[] = [];
  const kept: string[] = [];
  for (let index = 1; index < conversation.length; index += 1) {
    if (conversation[index]!.role !== "user") continue;
    const upTo = conversation.slice(0, index + 1);
    const reading = readNameConfirmation(upTo);
    if (reading?.kind === "accepted") accepted.push(reading.name);
    if (reading?.kind === "declined") {
      const asked = [...upTo.slice(0, -1)].reverse().find((turn) => turn.role === "assistant");
      const typed = asked ? TYPED_IN_QUESTION.exec(asked.content)?.[1]?.trim() : undefined;
      if (typed) kept.push(typed);
    }
  }
  return { accepted, kept };
}
