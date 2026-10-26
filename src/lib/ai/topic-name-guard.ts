import { topicNotANameEnabled } from "@/lib/config/chat-quality-flags";
import { TEAM_SUBJECT_LABEL, allowsTeamSubject } from "@/lib/forms/team-subject";
import type { ChatFormProposal } from "@/types";

import type { AskRequest, AskResponse } from "./types";

/**
 * TOPIC_NOT_A_NAME_ENABLED: what a coaching is about is never who it is for.
 *
 * QA, 25-26 Oct 2026 (both apps, invented names): "coaching form efts spa"
 * put Employee "efts spa"; "can u creat a coachng form for efts and the spa
 * for my team" put "efts" and ignored "for my team"; after "coaching for
 * efts", the reply "weekly" became Employee "Weekly"; "I already told you for
 * the whole team" was not read as the team.
 *
 * On every card turn: an Employee whose every word is a topic or a plain word
 * (efts, spa, weekly, closing duties …) is not a person. When the manager has
 * said the form is for their team ("for my team", "the whole team") and the
 * form may be a team form, the card becomes the team's; otherwise the
 * Employee is left blank and the card asks who it is for. A real name, a
 * one-word name and a team card are unchanged. Off, the card is as it is.
 *
 * The same file in Ask Bubbles.
 */

const TOPIC_WORDS = new Set(
  (
    "eft efts spa spas weekly daily monthly nightly night nights closing opening duties duty cleaning clean sanitizing sanitation " +
    "dress code attendance tardiness phone cell cash handling register drawer visitors conduct standards safety uniform behavior " +
    "behaviour performance sales training schedule breaks break customer customers guest guests service products product inventory " +
    "recipe measuring acknowledgements acks onboarding woven work sheet sheets worksheet worksheets checklist checklists " +
    "the a an and or of for to my our your their team staff crew everyone all"
  ).split(" "),
);
const FOR_THE_TEAM = /\bfor\s+(?:my|our|the)(?:\s+(?:whole|entire|full))?\s+(?:team|staff|crew)\b|\b(?:whole|entire)\s+team\b|\ball\s+(?:of\s+)?(?:my|our|the)\s+team\b/i;
/** "not", "never", "don't", "except" … earlier in the same clause turn the team phrase around. */
const NEGATED = /\b(?:not|never|no|don'?t|do\s+not|doesn'?t|isn'?t|without|except|instead\s+of)\b/i;

/**
 * QA-2 negation probes, 26 Oct 2026: "coaching form efts, not for my team",
 * "it is not for the whole team", "don't make it for the whole team", and a
 * later "no, not for my team, just for efts" after "for my team" made the team
 * card. The latest turn that mentions the team decides, and a team phrase
 * with a negation before it in its clause is a no.
 */
function forTheTeam(said: readonly string[]): boolean {
  let team = false;
  for (const turn of said) {
    for (const clause of turn.split(/[,.;!?]+/)) {
      const hit = FOR_THE_TEAM.exec(clause);
      if (!hit) continue;
      team = !NEGATED.test(clause.slice(0, hit.index));
    }
  }
  return team;
}

const WHO_ASK = "Who is this form for — one employee, or the whole team? Tell me here.";

export function withTopicNotAName(response: AskResponse, request: AskRequest): AskResponse {
  if (!topicNotANameEnabled()) return response;
  const said = [...request.history.filter((turn) => turn.role === "user").map((turn) => turn.content), request.question];
  return guardTopicName(response, said);
}

export function topicOnly(name: string): boolean {
  const words = name.toLowerCase().split(/[^a-z'’-]+/).filter(Boolean);
  return words.length > 0 && words.every((word) => TOPIC_WORDS.has(word));
}

export function guardTopicName(response: AskResponse, said: readonly string[]): AskResponse {
  const proposal = response.formProposal;
  const name = proposal?.employeeName?.trim();
  if (!proposal || !name || proposal.subject === "team" || !topicOnly(name)) return response;
  const shown = new RegExp(`\\*\\*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*\\*`, "gi");
  if (allowsTeamSubject(proposal.templateKey) && forTheTeam(said)) {
    const next: ChatFormProposal = {
      ...proposal,
      employeeName: TEAM_SUBJECT_LABEL,
      employeeRole: null,
      subject: "team",
      status: "ready",
      supportsInlineDraft: true,
    };
    return { ...response, content: response.content.replace(shown, `**${TEAM_SUBJECT_LABEL}**`), formProposal: next };
  }
  const next: ChatFormProposal = { ...proposal, employeeName: null, status: "needs_employee", supportsInlineDraft: false };
  let content = response.content.replace(shown, "the employee");
  if (!content.includes(WHO_ASK)) content = `${content.trim()}\n\n${WHO_ASK}`;
  return { ...response, content, formProposal: next };
}
