import { caNameFromChatEnabled } from "@/lib/config/chat-quality-flags";

import { rosterFullName } from "./person-guard";

/**
 * ============================================================================
 * A CORRECTIVE ACTION'S NAME IS CORRECTED FROM THE CHAT
 * ============================================================================
 *
 * CA_NAME_FROM_CHAT_ENABLED. Pau, 3 Nov 2026: "fix her last name …" on a
 * Corrective Action must really change the Employee Name on the card and the
 * draft, and say so. NAME_CORRECTION_WORDS already hands such a turn on as
 * "change her name to <the name>"; until now a Corrective Action took only its
 * date and payroll answer from chat, so the reply said how to edit the line.
 *
 * The safe rule stays: a different person's name is never written. The new
 * name shares a first or a last name with the name on the form, and exactly
 * one person on the manager's roster has it — written in the roster's own
 * spelling. Anything else changes nothing.
 */
const RENAME = /^\s*change\s+(?:her|his|their|the)\s+(?:employee'?s?\s+)?name\s+to\s+(.+?)\s*[.!]?\s*$/i;

function words(name: string): string[] {
  return name.toLowerCase().split(/[^a-z'-]+/).filter(Boolean);
}

/** The roster spelling to write, or null when this turn renames nobody safely. */
export function caNameFromChat(question: string, currentName: string | null | undefined): string | null {
  if (!caNameFromChatEnabled() || !currentName?.trim()) return null;
  const typed = RENAME.exec(question)?.[1]?.replace(/^["'“‘]+|["'”’]+$/g, "").trim();
  if (!typed) return null;
  const said = words(typed);
  const current = words(currentName);
  if (said.length < 2 || current.length === 0) return null;
  if (said.join(" ") === current.join(" ")) return null;
  const shares = said[0] === current[0] || said[said.length - 1] === current[current.length - 1];
  if (!shares) return null;
  return rosterFullName(typed);
}
