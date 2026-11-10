import { exitOtherPersonNotSubjectEnabled } from "@/lib/config/chat-quality-flags";
import { exitEmployeeQuestion } from "@/lib/forms/exit-intake";

import type { AskRequest, AskResponse } from "./types";

/*
 * ============================================================================
 * THE LETTER'S OTHER PERSON IS NEVER THE EXIT FORM'S SUBJECT (EXIT_OTHER_PERSON_NOT_SUBJECT_ENABLED)
 * ============================================================================
 *
 * QA's Sunny round-5 live tester (8 Nov 2026), item 4b, pre-existing: a termination letter naming "your Salon Director,
 * <B>" was answered "Which of them is this **Resignation/Exit Form** for — **<B>** or **<A>**?", with "**Job title:**
 * Salon Director" under it: the letter's other person offered as the subject, and her title echoed as the employee's.
 * With the flag on, a candidate whose every mention in the manager's words comes right after a title ("your Salon
 * Director, <B>", "Salon Director <B>") is not offered, and that title line goes with her. One candidate left: the
 * plain "Who is this … for?" question. Off, the answer as it was.
 */

const QUESTION = /^Which of them is this \*\*(.+?)\*\* for — (.+?)\? Tell me and I'll fill in what you've already described\.$/m;
const TITLE_WORDS = String.raw`(?:director|manager|supervisor|lead|coordinator|owner|dm|sd|gm|hr|trainer|assistant)`;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every mention of the name sits right after a title. */
function onlyAfterATitle(name: string, said: string): boolean {
  const word = new RegExp(String.raw`(?<![\p{L}])${escape(name)}(?![\p{L}])`, "giu");
  const mentions = [...said.matchAll(word)];
  if (mentions.length === 0) return false;
  const afterTitle = new RegExp(String.raw`\b${TITLE_WORDS}\s*,?\s*$`, "i");
  return mentions.every((mention) => afterTitle.test(said.slice(Math.max(0, (mention.index ?? 0) - 40), mention.index)));
}

/** The titles that sit right before the name ("Salon Director" for "your Salon Director, <B>"). */
function titlesBefore(name: string, said: string): string[] {
  const pattern = new RegExp(String.raw`((?:[\p{L}]+\s+){0,2}${TITLE_WORDS})\s*,?\s*${escape(name)}(?![\p{L}])`, "giu");
  return [...said.matchAll(pattern)].map((match) => match[1]!.replace(/^(?:your|our|the|my|her|his|their)\s+/i, "").trim());
}

export function withExitOtherPersonNotOffered(response: AskResponse, request: Pick<AskRequest, "history" | "question">): AskResponse {
  if (!exitOtherPersonNotSubjectEnabled()) return response;
  const asked = QUESTION.exec(response.content);
  if (!asked) return response;
  const names = [...asked[2]!.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]!);
  const said = [...(request.history ?? []).filter((turn) => turn.role === "user").map((turn) => turn.content), request.question].join("\n");
  const others = names.filter((name) => onlyAfterATitle(name, said));
  if (others.length === 0 || others.length === names.length) return response;
  const titles = new Set(others.flatMap((name) => titlesBefore(name, said)).map((title) => title.toLowerCase()));
  const kept = names.filter((name) => !others.includes(name));
  const content = response.content
    .replace(asked[0], exitEmployeeQuestion(asked[1]!, kept.length > 1 ? kept : []))
    .split("\n")
    .filter((line) => {
      const title = /^\*\*Job title:\*\*\s*(.+?)\s*$/i.exec(line)?.[1];
      return !title || !titles.has(title.toLowerCase());
    })
    .join("\n");
  return { ...response, content };
}
