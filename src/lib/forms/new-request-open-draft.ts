import { newRequestOpenDraftEnabled } from "@/lib/config/chat-quality-flags";
import { extractEmployeeNames, samePerson } from "@/lib/forms/proposal";
import { detectTemplateIntent } from "@/lib/forms/template-intent";

/**
 * ============================================================================
 * WITH HER DRAFT OPEN, A NEW REQUEST FOR HER IS A NEW CARD
 * ============================================================================
 *
 * NEW_REQUEST_OPEN_DRAFT_ENABLED. QA's live check, 3 Nov 2026, a fresh chat:
 * "a CA" → "<name> failed to take trash out and put rugs out untl 12;30pm" →
 * Create → "make me a CA for <name> for being late to opening this morning".
 * The open draft was redrafted from both incidents ("Redrafted the Corrective
 * Action Form … from what you described"), its policy from neither, and the
 * late opening got no card of its own. The message came before the first
 * draft was saved, so the redraft path read the draft as blank; the open-draft
 * paths (OPEN_DRAFT_KEEPS_TURNS) would have sent it there too.
 *
 * A turn that asks for a form, names the open draft's person and is mostly
 * about something not said before in this chat is a NEW request: it goes to
 * the intake as if no form were open, and the open draft is not touched. A
 * bare repeat ("a CA for <name>"), a follow-up about the same incident or a
 * turn about somebody else is not this.
 */

interface Turn {
  readonly role: string;
  readonly content: string;
}

/** The words of a turn beyond the form, the request and the name. */
function aboutWords(text: string, employeeName: string): string[] {
  const name = new Set(employeeName.toLowerCase().split(/\s+/));
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((word) => word && !name.has(word))
    .filter((word) => !/^(?:make|me|a|an|the|create|start|do|please|can|you|for|ca|c\/a|corrective|action|form|coaching|verbal|written|warning|new|another|i|need|want|to)$/.test(word));
}

export function newRequestForOpenDraft(input: {
  readonly question: string;
  readonly history: readonly Turn[];
  /** The open draft's employee. */
  readonly employeeName: string | null | undefined;
}): boolean {
  const employee = (input.employeeName ?? "").trim();
  if (!newRequestOpenDraftEnabled() || !employee) return false;
  const question = input.question.trim();
  if (detectTemplateIntent(question).kind === "none") return false;
  if (!extractEmployeeNames(question).some((name) => samePerson(name, employee))) return false;
  const about = aboutWords(question, employee);
  if (about.length < 3) return false;
  const said = new Set(
    input.history.filter((turn) => turn.role === "user").flatMap((turn) => aboutWords(turn.content, employee)),
  );
  const fresh = about.filter((word) => !said.has(word)).length;
  return fresh >= 3 && fresh * 2 >= about.length;
}
