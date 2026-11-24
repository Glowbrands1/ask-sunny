import { createHash } from "node:crypto";

import type { AskResponse } from "@/lib/ai/types";
import { coachingForEveryoneEnabled, staffPickerStoreTitlesEnabled } from "@/lib/config/chat-quality-flags";
import { loadScopedRoster, readDirectoryFacts } from "@/lib/forms/employee-roster";
import { authorizeInstance } from "@/lib/forms/instance-scope";
import { createInstance, loadInstance, type LoadedInstance } from "@/lib/forms/instances";
import { authorizeLocation } from "@/lib/forms/location-scope";
import { samePerson } from "@/lib/forms/proposal";
import { copyFormContent } from "@/lib/forms/same-form-copy";
import type { RosterEmployee } from "@/lib/forms/employee-match";
import { salonStaff, type StaffPerson } from "@/lib/forms/staff-picker";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * "CREATE THIS COACHING FORM FOR EVERYONE ON MY TEAM" — ONE DRAFT EACH
 * ============================================================================
 *
 * COACHING_FOR_EVERYONE_ENABLED (ported from Ask Bubbles). Pau, 3 Nov 2026,
 * for a Location Manager who
 * had written one coaching message for her whole store (Ask Bubbles): "also having to
 * replicate that coaching verbiage to all coaching forms so she doesn't have
 * to copy paste". Both the team card and one form per person are wanted.
 *
 * WITH A COACHING DRAFT OPEN (the team card, or one person's), the manager
 * asks for it for everyone. Ask Sunny answers with ONE confirmation listing
 * the people at that draft's salon — the same scoped roster the staff picker
 * lists: active, no shared logins, salon titles only — and the count. Nothing
 * is created until she says "create all" (or "create all except <names>").
 *
 * Then, for each person, the ordinary create path (`createInstance`,
 * unchanged) makes a DRAFT Coaching Form with that person's own name,
 * position and salon, and the open draft's content is copied onto it with
 * the name swapped (`copyFormContent`, as "do the same coaching form for …"
 * does). No model call: the wording is the one she already wrote. Nothing is
 * finalized. Each draft's id is derived from the source draft and the person,
 * so "create all" said twice — or a lost response retried — returns the drafts
 * already made instead of a second set. At most 40 people at once.
 */

export const MAX_PEOPLE = 40;

/** A directory person with an id (to tell two same-named people apart) and their title. */
type Person = RosterEmployee & StaffPerson;

/* QA's code audit, coach_team D (20 Nov 2026): "the whole team", "my team", "the entire staff" are everyone too. */
const TARGET = String.raw`(?:everyone|everybody|each|every|all|(?:(?:the|my|our)\s+)?(?:whole|entire)\s+(?:team|staff|salon)|(?:my|our|the)\s+(?:team|staff))`;
const ASKS = [
  // "Create this coaching form for everyone on my team", "do this coaching for the whole team"
  new RegExp(String.raw`\b(?:this|that|the\s+same)\s+(?:coaching(?:\s+(?:form|draft|card))?|form|draft|card)\s+for\s+${TARGET}\b`, "i"),
  // "for the whole staff, one form each", "one form per person", "individual forms"
  /\bone\s+(?:coaching\s+)?(?:form|draft)?\s*(?:each|per\s+(?:person|employee|team\s+member|associate))\b|\b(?:individual|separate)\s+(?:coaching\s+)?(?:forms|drafts)\b|\beach\s+(?:person|employee|team\s+member|associate)(?:'s)?\s+(?:own\s+)?(?:coaching\s+)?(?:form|draft)\b/i,
  // "replicate that coaching verbiage to all coaching forms"
  new RegExp(
    String.raw`\b(?:replicate|copy|duplicate|apply|carry|put)\b[^.?!]{0,40}\b(?:verbiage|wording|words|details|text|content|form|draft)\b[^.?!]{0,30}\b(?:to|onto|on|for|into)\s+(?:all|every|each|everyone|everybody)\b`,
    "i",
  ),
];

export function asksForEveryone(text: string): boolean {
  return ASKS.some((pattern) => pattern.test(text));
}

/** The confirmation's own words, read back from the next turn's history. */
const CONFIRM_MARK = "to make one draft **Coaching Form** each";
/** A partial failure's own words: they ask "create all" again, for the people not made (QA's audit, item B). */
const RETRY_MARK = "Say **create all** again to retry them";
const asksCreateAll = (text: string) => text.includes(CONFIRM_MARK) || text.includes(RETRY_MARK);

/*
 * THE ANSWER TO "create all?" (QA's code audit, coach_team C, 20 Nov 2026). Once the confirmation was asked, an ordinary
 * yes answers it: "yes", "yes please", "create all of them", "go ahead and make them", with or without "except <names>".
 * A no, a hold or a question never does. Whether it was asked is the caller's record (the agent loop's), or the app's own
 * confirmation wording on the last reply; never the model's paraphrase of it.
 */
const DECLINES = /\b(?:no|nope|nah|not\s+(?:yet|now)|don'?t|do\s+not|cancel|stop|wait|hold\s+(?:on|off)|never\s*mind|nevermind)\b/i;
const AGREES = /^\s*(?:yes|yeah|yep|yup|ya|sure|ok(?:ay)?|please|go\s+ahead|do\s+it|sounds\s+good|perfect|great|create|make|do)\b/i;
const LEAVES_OUT = /\b(?:except(?:\s+for)?|but(?:\s+not)?|without|minus|other\s+than|leav(?:e|ing)\s+out|skip(?:ping)?)\s+(.+?)\s*[.!]*$/i;

/** A yes to the "create all" confirmation, with the names it leaves out; null for anything else. */
export function answersCreateAll(text: string): { except?: string } | null {
  const said = text.trim();
  if (!said || said.includes("?")) return null;
  const leaves = LEAVES_OUT.exec(said);
  const head = leaves ? said.slice(0, leaves.index) : said;
  if (DECLINES.test(head) || !AGREES.test(head) || head.split(/\s+/).length > 12) return null;
  return leaves ? { except: leaves[1] } : {};
}

function lastAssistant(history: readonly Pick<ChatMessage, "role" | "content">[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]!.role === "assistant") return history[index]!.content ?? "";
  }
  return "";
}

function displayName(person: Person): string {
  return `${person.preferredFirstName?.trim() || person.firstName} ${person.lastName}`.trim();
}

function answer(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}

/** Each person's draft id: the same source and person always give the same card id. */
export function bulkProposalId(sourceInstanceId: string, personId: string): string {
  return `bulk-${createHash("sha256").update(`${sourceInstanceId}:${personId}`).digest("hex").slice(0, 40)}`;
}

/** "except Remy Calder and Juno" — the people left out, matched by full or first name. */
function excluded(text: string | undefined, people: readonly Person[]): { out: Set<string>; unknown: string[] } {
  const out = new Set<string>();
  const unknown: string[] = [];
  if (!text) return { out, unknown };
  for (const raw of text.split(/\s*(?:,|\band\b|&)\s*/i).map((part) => part.trim()).filter(Boolean)) {
    const name = raw.replace(/[.!]+$/, "");
    const full = people.filter((person) => samePerson(displayName(person), name) || samePerson(`${person.firstName} ${person.lastName}`, name));
    const first = full.length > 0 ? full : people.filter((person) => [person.firstName, person.preferredFirstName].some((given) => given?.toLowerCase() === name.toLowerCase()));
    if (first.length === 1) out.add(first[0]!.id);
    else unknown.push(name);
  }
  return { out, unknown };
}

/** Why one person's draft failed, in a few words (never a stack). */
function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message ? message.replace(/\s+/g, " ").slice(0, 160) : "it could not be saved just now";
}

function hasContent(loaded: LoadedInstance): boolean {
  return loaded.values.some(
    (row) => row.filledBy !== "system" && (Boolean(row.value?.trim()) || row.checked.length > 0),
  );
}

type TurnInput = {
  request: Request;
  question: string;
  history: readonly Pick<ChatMessage, "role" | "content">[];
  activeInstanceId?: string;
  /** The agent loop's record: its last reply asked this draft's "create all" confirmation. */
  confirmationAsked?: boolean;
  /** Called once for each draft saved (QA's audit, item 14b: the agent loop's reply never says nothing was saved over one). */
  onCreated?: () => void;
};

/**
 * The chat turn: a request for everyone, or the confirmation of one. Null for
 * any other turn, with no draft open, or with the flag off.
 */
export async function coachingForEveryoneTurn(input: TurnInput): Promise<AskResponse | null> {
  return (await coachingForEveryone(input))?.response ?? null;
}

/** The same turn, also saying whether its reply asked the confirmation (for the agent loop's record). */
export async function coachingForEveryone(input: TurnInput): Promise<{ response: AskResponse; askedConfirmation: boolean } | null> {
  const response = await everyoneTurn(input);
  if (!response) return null;
  return { response, askedConfirmation: asksCreateAll(response.content) };
}

async function everyoneTurn(input: TurnInput): Promise<AskResponse | null> {
  if (!coachingForEveryoneEnabled() || !input.activeInstanceId) return null;
  const question = input.question.trim();
  const asked = input.confirmationAsked === true || asksCreateAll(lastAssistant(input.history));
  const confirmed = asked ? answersCreateAll(question) : null;
  if (!confirmed && !asksForEveryone(question)) return null;

  let source: LoadedInstance;
  let actor: Awaited<ReturnType<typeof authorizeInstance>>["actor"];
  try {
    ({ actor, loaded: source } = await authorizeInstance(input.request, input.activeInstanceId, "view"));
  } catch {
    return null;
  }
  if (!actor.role || !hasPermission(DEFAULT_PERMISSION_MATRIX, actor.role, "create_coaching_form")) return null;
  const form = source.instance;
  if (form.templateKey !== "coaching") {
    return answer(
      `One form per person from the same wording is for the **Coaching Form**. A ${form.templateName} is about one person — tell me who the next one is for.`,
    );
  }
  if (!hasContent(source)) {
    return answer(
      "Write the coaching on this draft first — tell me what it is about, or fill in the Details on the card — then say **create this coaching form for everyone on my team** and I'll make one draft each with the same wording.",
    );
  }
  const locationId = form.locationId;
  if (!locationId || authorizeLocation(actor.scope ?? null, locationId).kind !== "authorized") {
    return answer("This draft has no salon of yours on it, so I can't tell whose team to use. Choose the salon on the card first.");
  }

  // Woven's title where the directory read gives it; the plain scoped roster otherwise (as the staff picker reads it).
  const facts = await readDirectoryFacts(actor.scope ?? null);
  const roster: Person[] =
    facts.length > 0 ? facts.map((person) => ({ ...person, positionName: person.title })) : await loadScopedRoster(actor.scope ?? null);
  const people = roster
    .filter((person) => person.salonIds.includes(locationId))
    .filter((person) => !staffPickerStoreTitlesEnabled() || salonStaff(person))
    .filter((person) => !samePerson(displayName(person), form.employeeName))
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const store = form.locationName ?? "this salon";
  if (people.length === 0) return answer(`I couldn't find anyone on the directory for **${store}**, so nothing was created.`);
  if (people.length > MAX_PEOPLE) {
    return answer(
      `**${store}** has ${people.length} people on the directory — more than ${MAX_PEOPLE} at once. Nothing was created. Name the people this is for (up to ${MAX_PEOPLE}), and I'll make a draft for each.`,
    );
  }

  if (!confirmed) {
    const list = people.map((person) => `- ${displayName(person)}${person.positionName ? ` — ${person.positionName}` : ""}`).join("\n");
    return answer(
      [
        `This makes **${people.length}** draft Coaching Forms, one for each person at **${store}**, each with the Details on this draft and that person's own name and position:`,
        list,
        `Reply **create all ${people.length}** ${CONFIRM_MARK}, or **create all except <name>, <name>** to leave people out. Nothing is created until you do, and nothing is finalized — each one stays a draft for you to review.`,
      ].join("\n\n"),
    );
  }

  const { out, unknown } = excluded(confirmed.except, people);
  if (unknown.length > 0) {
    return answer(
      `I couldn't find ${unknown.map((name) => `**${name}**`).join(", ")} on the list above, so nothing was created. Reply **create all** or **create all except <name>** with names from the list.`,
    );
  }
  const chosen = people.filter((person) => !out.has(person.id));
  const made: string[] = [];
  const already: string[] = [];
  /*
   * ONE PERSON'S FAILURE IS THAT PERSON'S (QA's code audit, coach_team B, 20 Nov 2026). Each draft is made and filled on
   * its own: a failure is reported by name with its reason, beside what was made, never as a failed lookup for the whole
   * turn. A draft left empty by an earlier failure is filled on the retry, never listed as already made.
   */
  const failed: string[] = [];
  for (const person of chosen) {
    try {
      const filled = await draftFor(person);
      (filled === "already" ? already : made).push(displayName(person));
    } catch (error) {
      failed.push(`**${displayName(person)}** (${reasonOf(error)})`);
    }
  }
  async function draftFor(person: Person): Promise<"made" | "already"> {
    const created = await createInstance({
      templateKey: form.templateKey,
      variantKey: form.variantKey,
      employeeName: displayName(person),
      employeeRole: person.positionName ?? null,
      locationId,
      locationName: form.locationName,
      createdBy: actor.id,
      createdByRole: actor.role,
      source: "ask_sunny",
      proposalId: bulkProposalId(form.id, person.id),
    });
    const target = await loadInstance(created.id);
    if (!target) throw new Error("its draft could not be read back");
    if (created.reused && hasContent(target)) return "already";
    input.onCreated?.();
    const written = await copyFormContent({ source, target, actorId: actor.id });
    if (Object.keys(written.values).length === 0 && Object.keys(written.checked).length === 0) throw new Error("the Details could not be written on its draft");
    return "made";
  }
  const lines = [
    made.length > 0
      ? `Created **${made.length}** draft Coaching Form${made.length === 1 ? "" : "s"} at **${store}** with the same Details, each with that person's own name: ${made.join(", ")}.`
      : `Nothing new was created.`,
    ...(failed.length > 0
      ? [`Not made: ${failed.join(", ")}. ${RETRY_MARK}; the drafts already made are kept, not made twice.`]
      : []),
    ...(already.length > 0 ? [`Already made from this draft earlier, left as they are: ${already.join(", ")}.`] : []),
    "They are drafts in Form Monitoring — none is finalized. Open each one to check it reads right for that person, pronouns included, before you finalize it.",
  ];
  return answer(lines.join("\n\n"));
}
