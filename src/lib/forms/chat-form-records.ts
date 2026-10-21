import "server-only";

import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import { businessToday } from "@/lib/business-date";
import type { AccessScope, Role } from "@/types";

import type { FormsActor } from "./access";
import { FOLLOW_UP_LABEL, followUpState } from "./follow-up";
import { resolveFormsVisibility } from "./forms-visibility";
import { instanceListFilterFor, visibleInstances } from "./instance-scope";
import { listInstances, type InstanceRow } from "./instances";

/**
 * ============================================================================
 * "DOES ELLIE HAVE PREVIOUS COACHINGS?" — ANSWERED FROM FORM MONITORING
 * ============================================================================
 *
 * Production feedback: asked whether an employee had prior coaching, Sunny said
 * it could not look that up and sent the manager to Forms → Form Monitoring —
 * the screen holding exactly the answer, one click away, read from the same
 * table this app writes. So a question about forms ALREADY ON FILE now reads
 * that record and hands the model a FORMS ON FILE block.
 *
 * THE SAME VISIBILITY AS THE SCREEN, AND NOTHING WIDER. The read goes through
 * `resolveFormsVisibility`, `instanceListFilterFor` and `visibleInstances` —
 * the one rule Form Monitoring, its API and the Overview all apply: home salon
 * only, every salon for administrators and designated accounts, exit forms only
 * for roles that may create them. Chat's report scope (`resolveScopeFor`) is
 * deliberately NOT used: it expands a district to its salons, which forms
 * visibility does not.
 *
 * METADATA ONLY. Which form, about whom, at which salon, when, and where it
 * stands. Never a field's contents: what a coaching record says belongs in the
 * record, opened by a person, not paraphrased into a chat answer.
 *
 * NAMES ARE MATCHED, NEVER GUESSED. The question's words narrow the query
 * (`employeeNameWords`), and a row counts as NAMED only when every word of its
 * employee name appears in the question. A row matching on a first name alone
 * is listed as a POSSIBLE match, so "is Ellie Sendgraff the one you mean?" is
 * the model's to ask rather than this file's to decide.
 */

/* ------------------------------------------------------------------ gate --- */

const FORM_NOUN =
  "(?:coachings?|coaching (?:forms?|records?|notes?|sessions?|files?)|forms?|files?|write[- ]?ups?|corrective(?: actions?)?(?: forms?)?|ca|cas|cafs?|ca forms?|warnings?|documentation|records?|epps?|follow[- ]?ups?|disciplinary|discipline|exit (?:forms?|interviews?))";

const FORM_RECORDS_PATTERNS: readonly RegExp[] = [
  // "previous coachings", "any write-ups", "open follow-ups", "past forms"
  new RegExp(
    `\\b(?:previous|prior|past|earlier|older|existing|recent|last|any|outstanding|open|pending|draft|drafted|unfinished|overdue|finalized|filed)\\s+${FORM_NOUN}\\b`,
  ),
  // "has she been coached", "was he ever written up"
  /\b(?:been|ever|already|previously|before)\s+(?:been\s+)?(?:coached|written up|wrote up|documented|disciplined|warned)\b/,
  /\b(?:coached|written up|documented|disciplined|warned)\s+(?:before|previously|already)\b/,
  // "coaching history", "form history", "disciplinary record"
  /\b(?:coaching|form|forms|write[- ]?up|disciplinary|corrective(?: action)?|performance)\s+(?:history|records?)\b/,
  /\bon file\b/,
  /\bform monitoring\b/,
  // "forms I created", "coachings we have done", "forms filed"
  new RegExp(
    `\\b${FORM_NOUN}\\s+(?:(?:i|we|you|they|she|he)\\s+)?(?:have\\s+|has\\s+|had\\s+)?(?:been\\s+)?(?:filed|created|done|completed|submitted|finalized|started|written)\\b`,
  ),
  new RegExp(`\\bhow many\\s+${FORM_NOUN}\\b`),
  // "coachings for ellie", "write-ups on dana"
  /\b(?:coachings|write[- ]?ups|forms|corrective actions|cas|warnings)\s+(?:for|on|about)\s+\w/,
];

/**
 * Whether this question asks about forms that ALREADY EXIST — as opposed to the
 * templates (the inventory gate) or a new one (the proposal gate), both of which
 * run earlier and end the turn. Pure and cheap.
 */
export function isFormRecordsQuestion(question: string): boolean {
  const text = question.toLowerCase().replace(/\s+/g, " ");
  return FORM_RECORDS_PATTERNS.some((pattern) => pattern.test(text));
}

/* ----------------------------------------------------------------- names --- */

/*
 * Words that are never part of a person's name in these questions. Kept broad
 * on purpose: a missed stop word costs a wider query that the scoring below
 * then discards, while a person's name in this list could never be matched.
 */
const STOP_WORDS = new Set(
  (
    "a about after again all also am an and any anyone anything are as at be been before being " +
    "both but by can check could did do does doing done during each employee employees ever for " +
    "from had has have having he her here hers him his how i if in into is it its just last let " +
    "like look me mine more most my need no not now of on once only or other our out over own " +
    "please previous previously prior past earlier older existing recent recently same see she " +
    "should show so some still such tell than that the their them then there these they this " +
    "those through to too under until up very was we were what when where which while who whom " +
    "why will with would you your yours already currently today yesterday week weeks month " +
    "months year years ago time times new open opened pending draft drafted unfinished overdue " +
    "finalized filed outstanding coach coached coaching coachings form forms record records " +
    "note notes session sessions write writeup writeups written wrote documentation documented " +
    "corrective action actions warning warnings disciplinary discipline disciplined epp epps " +
    "exit interview interviews follow followup followups history file monitoring many much " +
    "created create completed submitted started team member members staff salon store manager " +
    "director stylist consultant sunny ask know find list give get got any people person " +
    "performance plan plans has hasnt havent doesnt didnt isnt wasnt dont ca cas caf cafs files"
  ).split(" "),
);

/** The words of a question that could be part of somebody's name. */
export function candidateNameWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
  return [...new Set(words)].slice(0, 8);
}

function nameWords(name: string): string[] {
  return name.toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 2);
}

export interface NameMatches {
  /** Every word of the employee's name appears in the question. */
  named: InstanceRow[];
  /** Part of the name appears — a first name alone, usually. */
  possible: InstanceRow[];
}

/** Splits rows by how fully the question names their employee. Pure. */
export function matchRowsToQuestion(
  rows: readonly InstanceRow[],
  words: readonly string[],
): NameMatches {
  const asked = new Set(words);
  const named: InstanceRow[] = [];
  const possible: InstanceRow[] = [];
  for (const row of rows) {
    const parts = nameWords(row.employeeName);
    if (parts.length === 0) continue;
    const hits = parts.filter((part) => asked.has(part)).length;
    if (hits === parts.length) named.push(row);
    else if (hits > 0) possible.push(row);
  }
  return { named, possible };
}

/* ---------------------------------------------------------------- render --- */

export const FORM_RECORDS_HEADING = "FORMS ON FILE (FORM MONITORING)";

const STATUS_LABEL: Record<InstanceRow["status"], string> = {
  draft: "draft — not finalized",
  finalized: "finalized",
  revised: "revised — replaced by a newer version",
};

function describeRow(row: InstanceRow, today: string): string {
  const state = followUpState(row, today);
  const parts = [
    `${row.formDate} — ${row.templateName}`,
    `employee: ${row.employeeName}${row.employeeRole ? ` (${row.employeeRole})` : ""}`,
    `salon: ${row.locationName ?? "none recorded"}`,
    `status: ${STATUS_LABEL[row.status]}`,
  ];
  if (row.followUpDate) parts.push(`follow-up date: ${row.followUpDate}`);
  if (state !== "drafted" && state !== "untracked") parts.push(`follow-up: ${FOLLOW_UP_LABEL[state]}`);
  if (row.archivedAt) parts.push("archived");
  return `- ${parts.join("; ")}`;
}

function scopeSentence(visibility: AccessScope): string {
  return visibility.level === "global"
    ? "This list covers every salon: this user may see all salons' forms."
    : "This list covers only the salons this user may see in Form Monitoring (their home salon). A form filed at another salon is not visible to them and is not listed — so no match here means none on file at their salon, not none anywhere.";
}

const RECORDS_RULES =
  "These are records of forms that exist, read from Form Monitoring for this user. Never mark them with a source marker. Only the form name, employee, salon, dates and status are shown — you have NOT seen what any form says, so never describe or guess its contents, reasons or wording. A draft is not a completed coaching. Tell the manager they can open any of these in Forms → Form Monitoring.";

export function renderFormRecordsBlock(input: {
  visibility: AccessScope;
  /** The name words searched for, or empty when the question named nobody. */
  words: readonly string[];
  matches: NameMatches | null;
  recent: readonly InstanceRow[];
  today: string;
}): string {
  const { words, matches, recent, today } = input;
  const sections: string[] = [
    FORM_RECORDS_HEADING,
    `${RECORDS_RULES} ${scopeSentence(input.visibility)}`,
  ];

  if (matches) {
    const searched = words.join(", ");
    if (matches.named.length > 0) {
      sections.push(
        `Forms naming the person in the question (${matches.named.length}), newest first:\n${matches.named.map((row) => describeRow(row, today)).join("\n")}`,
      );
    } else {
      sections.push(
        `No form on file names the person in the question (searched for: ${searched}). Say so plainly — there is no coaching or other form on file for them at the salons this user can see.`,
      );
    }
    if (matches.possible.length > 0) {
      sections.push(
        `Possible matches — part of the name matches, so they may be somebody else. Ask before treating them as the same person:\n${matches.possible.map((row) => describeRow(row, today)).join("\n")}`,
      );
    }
  } else if (recent.length > 0) {
    sections.push(
      `The question names nobody. The ${recent.length} most recent forms this user can see, newest first:\n${recent.map((row) => describeRow(row, today)).join("\n")}`,
    );
  } else {
    sections.push("No forms are on file at the salons this user can see.");
  }

  return sections.join("\n\n");
}

export const FORM_RECORDS_UNAVAILABLE_BLOCK = `${FORM_RECORDS_HEADING}

Form Monitoring could not be read for this question. Say you could not check Form Monitoring just now and that the manager can look in Forms → Form Monitoring directly. Never guess whether any form exists.`;

/* ---------------------------------------------------------------- loader --- */

/** The authenticated caller, as this lookup needs it. */
export interface FormRecordsActor {
  subject?: string;
  verified?: boolean;
  role: Role | null;
  scope: AccessScope | null;
}

/**
 * The chat caller as Form Monitoring reads under them, or null when they may
 * not read it at all. Fails closed: no verified identity, no read. Throws only
 * when the visibility itself cannot be resolved.
 */
export async function chatFormsActor(actor: FormRecordsActor): Promise<FormsActor | null> {
  if (!actor.verified || !actor.subject || !actor.role || !actor.scope) return null;
  if (!hasPermission(DEFAULT_PERMISSION_MATRIX, actor.role, "view_form_monitoring")) return null;
  const visibility = await resolveFormsVisibility({
    subject: actor.subject,
    role: actor.role,
    scope: actor.scope,
  });
  return { id: actor.subject, role: actor.role, verified: true, scope: actor.scope, visibility };
}

const MATCH_LIMIT = 50;
const RECENT_LIMIT = 20;

/**
 * The FORMS ON FILE block for this turn, or null when this caller may not read
 * Form Monitoring at all. Never throws: a failed read becomes a block telling
 * the model to say it could not check, rather than an answer that silently
 * implies nothing is on file.
 *
 * @param nameText Where to look for a name: the question, or — when the
 *   question names nobody ("does she have any write-ups?") — the question and
 *   the manager's previous turn.
 */
export async function loadFormRecords(input: {
  actor: FormRecordsActor;
  question: string;
  previousQuestion?: string | null;
  today?: string;
}): Promise<{ block: string } | null> {
  const { actor } = input;
  // Fails closed: no verified identity, no read. Chat is live-only, so this is
  // the ordinary state of a signed-in manager.
  if (!actor.verified || !actor.subject || !actor.role || !actor.scope) return null;
  if (!hasPermission(DEFAULT_PERMISSION_MATRIX, actor.role, "view_form_monitoring")) return null;

  const today = input.today ?? businessToday();
  try {
    const formsActor = (await chatFormsActor(actor))!;
    const visibility = formsActor.visibility!;
    const filter = instanceListFilterFor(formsActor);

    let nameSource = input.question;
    let words = candidateNameWords(nameSource);
    if (words.length === 0 && input.previousQuestion) {
      nameSource = input.previousQuestion;
      words = candidateNameWords(nameSource);
    }

    if (words.length > 0) {
      const rows = visibleInstances(
        formsActor,
        await listInstances("all", MATCH_LIMIT, { ...filter, employeeNameWords: words }),
      );
      const matches = matchRowsToQuestion(rows, words);
      if (matches.named.length > 0 || matches.possible.length > 0) {
        return { block: renderFormRecordsBlock({ visibility, words, matches, recent: [], today }) };
      }
    }

    const recent = visibleInstances(formsActor, await listInstances("active", RECENT_LIMIT, filter));
    /*
     * A question that names somebody nobody on file matches is reported as
     * "no form names them" — with the recent list left out, so the model
     * cannot mistake somebody else's coaching for theirs.
     */
    const named = words.length > 0 && looksLikeItNamesSomebody(nameSource);
    return {
      block: renderFormRecordsBlock({
        visibility,
        words,
        matches: named ? { named: [], possible: [] } : null,
        recent,
        today,
      }),
    };
  } catch {
    return { block: FORM_RECORDS_UNAVAILABLE_BLOCK };
  }
}

/**
 * Whether the question itself carries a name-like phrase: two adjacent
 * candidate words ("ellie sendgraff"), or a candidate word after "for", "on",
 * "about", "does" or "has". Conservative — when unsure it says no, and the
 * model gets the recent list instead of a false "nothing on file".
 */
function looksLikeItNamesSomebody(question: string): boolean {
  const tokens = question.toLowerCase().replace(/['’]s\b/g, "").split(/[^a-z]+/).filter(Boolean);
  const candidate = (word: string | undefined) =>
    word !== undefined && word.length >= 2 && !STOP_WORDS.has(word);
  for (let i = 0; i < tokens.length; i += 1) {
    if (candidate(tokens[i]) && candidate(tokens[i + 1])) return true;
    if (["for", "on", "about", "does", "has", "did", "was", "is"].includes(tokens[i]!) && candidate(tokens[i + 1])) {
      return true;
    }
  }
  return false;
}
