import { weekdayOf } from "@/lib/business-date";

import { appConfig, type AppConfig } from "./app-config";
import { rulesBookText } from "./rules-book";

/**
 * The tool loop's system prompt (AGENT_LOOP_ENABLED). Static rules first (cached), then this turn's facts.
 * Company content (policies, names, places) is never written here: it comes from the tools and the manual's
 * own headings.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const built = new WeakMap<AppConfig, string>();

/** The static system prompt for an app config (cached per config). */
export function agentLoopRules(config: AppConfig = appConfig()): string {
  const cached = built.get(config);
  if (cached !== undefined) return cached;
  const place = config.locationWord;
  const places = config.locationWordPlural;
  // The reports read_stats reads are the company's (`AgentLoopContent.statsReports`); none, and the line is left out.
  const statsReports = config.content({ place, places, staff: config.staffSystem }).statsReports;
  const statsLine = statsReports ? `- read_stats: ${statsReports} figures for the manager's ${places}, with how current each report is.\n` : "";
  const text = `You are ${config.appName}, the HR assistant for ${place} managers. You help them prepare HR forms (coaching, corrective action and the others listed below), look up their staff, and answer questions from the JBA Policy Manual.

You have tools. Use them; never guess what a tool would tell you.
- find_staff: look up every person before they go on a form (for a card, propose_form looks up employee_name itself).
- read_policy: a manual section's own wording and printed page, by heading. Quote it; never answer a policy question from memory.
- list_staff: one of the manager's own ${places}' staff, names and positions ("who's on my staff"; a form for a whole staff).
- search_knowledge: the company knowledge base (procedures, operations, training and leadership guides, policies).
- propose_form: shows a form card the manager presses Create on. Nothing is saved until they do. Fill every field the manager gave you.
- edit_form: changes a draft, or opens a new draft revising a finalized form.
- find_past_forms / read_form: forms on file, only when the manager asks about them (read_form of the form open on screen is always fine).
- open_form: puts a form on file on the manager's screen, when they ask to open, edit or see it.
- app_help: this app's own help.
- coach_team: a Coaching Form for the whole team (the team card), or one draft each from an open Coaching draft.
- read_reviews: the Google Reviews page's figures for the manager's ${places} (a global admin: every ${place}): month to date against the goal, this week and last, and L3 (last 3 full months), L6 (last 6 full months), YTD and each month, per ${place}.
${statsLine}- read_form_deletions: administrators only: who deleted a form, when and how, from the permanent deletion record.

How ${config.appName} fills a form (the company's rules, from real manager and HR reports):

${rulesBookText(config)}`;
  built.set(config, text);
  return text;
}

export function agentLoopSystem(input: {
  readonly managerName: string;
  readonly role: string;
  readonly salons: readonly string[];
  readonly today: string;
  readonly templates: readonly { key: string; name: string }[];
  readonly headings: readonly string[];
  readonly openFormId: string | null;
  /** The last reply showed a card not yet created: it is still on the manager's screen. */
  readonly cardOpen?: boolean;
  /** Fix batch item 6: the last reply's propose_form asked who this form is for (the server's record); its name. */
  readonly answeringWhoQuestion?: string | null;
}): string {
  const config = appConfig();
  const place = config.locationWord;
  const places = config.locationWordPlural;
  const weekday = WEEKDAYS[weekdayOf(input.today)] ?? "";
  const lines = [
    `Signed in: ${input.managerName || "a manager"} (${input.role}).`,
    input.salons.length > 0 ? `Their ${places}: ${input.salons.join(", ")}.` : `Their login is not tied to listed ${places}.`,
    `Today is ${weekday} ${input.today} (${place} local date).`,
    input.templates.length > 0
      ? `Forms this manager may create (template_key: name):\n${input.templates.map((row) => `- ${row.key}: ${row.name}`).join("\n")}`
      : "The forms library could not be read; do not propose a form.",
    input.headings.length > 0
      ? `JBA Policy Manual headings (use one exactly for a form's policy):\n${input.headings.map((heading) => `- ${heading}`).join("\n")}`
      : "The JBA Policy Manual could not be read; propose a form without a policy and say so.",
    input.openFormId ? `The form open on the manager's screen: instance_id ${input.openFormId} (read_form shows it).` : "",
    input.cardOpen ? "A card is open: your last reply showed a card the manager has not created yet; it is still on their screen." : "",
    input.answeringWhoQuestion
      ? `answering_who_question: your last reply asked who the ${input.answeringWhoQuestion} is for, and this message answers it. Look the name up with find_staff (person_evidence: the manager's words) before anything else; a first name alone is a name, never an acronym, a topic or a product.`
      : "",
  ];
  return lines.filter(Boolean).join("\n\n");
}
