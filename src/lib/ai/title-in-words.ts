/**
 * Whether a directory title is in the manager's words.
 *
 * QA round 10 (conv_mvnjo8k22hy75ii): the directory carries the title "HR",
 * and "she signed one box with a arrown throught the rest" contains the
 * letters "hr", so the Coaching Form said **Job title:** HR. A title is
 * found only as a whole word. A short all-capitals title is an initialism and
 * is found only as typed: "1 hr late" is an hour, not the HR department.
 */

const INITIALISM = /^[A-Z&]{1,4}$/;

function escaped(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function titleInWords(title: string, text: string): boolean {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const pattern = `(?<![A-Za-z0-9'’])${words.map(escaped).join("\\s+")}(?![A-Za-z0-9'’])`;
  return new RegExp(pattern, INITIALISM.test(title.trim()) ? "" : "i").test(text);
}
