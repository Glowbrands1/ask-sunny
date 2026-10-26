import { nameRespellEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest, AskResponse } from "./types";

/**
 * NAME_RESPELL_ENABLED: the manager's newest spelling of the employee wins.
 *
 * Ask Sunny conv_mvofjlco271mr0t, 25 Oct 2026 (name invented in the test):
 * "crete a ca for mara quil …", then "mara quill, tc, ks manhattan" — the
 * card kept "mara quil". When the newest manager turn names the card's
 * employee spelled within one letter in every word, that spelling goes on the
 * card and in the reply — only when the card's spelling is one the manager
 * typed earlier, so a directory spelling is never replaced by a typo. Another
 * person, or the same spelling, changes nothing. Off, the response is returned as it is.
 *
 * The same file in Ask Bubbles.
 */

export function withNameRespell(response: AskResponse, request: AskRequest): AskResponse {
  if (!nameRespellEnabled()) return response;
  const typed = request.history.filter((turn) => turn.role === "user").map((turn) => turn.content);
  return respellEmployee(response, request.question, typed);
}

export function respellEmployee(response: AskResponse, question: string, typed: readonly string[]): AskResponse {
  const proposal = response.formProposal;
  const name = proposal?.employeeName?.trim();
  if (!proposal || !name || proposal.subject === "team") return response;
  // Only a spelling the manager typed is replaced; a name read from the directory stays.
  if (!typed.some((turn) => turn.toLowerCase().includes(name.toLowerCase()))) return response;
  const spelled = respelling(name, question);
  if (!spelled) return response;
  // Typed in capitals or the card is capitalised: the name is shown in Title Case.
  const shown = /^[A-Z]/.test(name) || spelled === spelled.toUpperCase() ? titleCase(spelled.toLowerCase()) : spelled;
  const content = response.content.replace(new RegExp(`\\*\\*${escape(name)}\\*\\*`, "gi"), `**${shown}**`);
  return { ...response, content, formProposal: { ...proposal, employeeName: shown } };
}

/** The question's spelling of `name`, when it differs by at most one letter per word; else null. */
export function respelling(name: string, question: string): string | null {
  const target = name.toLowerCase().split(/\s+/).filter(Boolean);
  if (target.length < 2) return null;
  const words = question.split(/[^A-Za-z'’-]+/).filter(Boolean);
  for (let start = words.length - target.length; start >= 0; start -= 1) {
    const span = words.slice(start, start + target.length);
    const lower = span.map((word) => word.toLowerCase());
    if (!lower.every((word, index) => close(word, target[index]!))) continue;
    if (lower.every((word, index) => word === target[index])) return null;
    // QA-6/QA-7, 26 Oct 2026: "never Mara Quill", "not Mara Quill but …", "without Mara Quill" are not the newest
    // spelling; "no, Mara Quill" is a correction and is.
    if (words.slice(Math.max(0, start - 2), start).some((word) => /^(?:not|never|without|except)$/i.test(word))) continue;
    return span.join(" ");
  }
  return null;
}

function close(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 3 || a[0] !== b[0]) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function titleCase(text: string): string {
  return text.replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
