/**
 * Lines the app writes onto the manager's question.
 *
 * Form state (`stateSentences`), intake augmentation (`augmentIntakeQuestion`)
 * and grounded entities (`prepareGroundedQuestion`) put whole lines such as
 *
 *     The employee is Test Employee. Job title: CA. It happened at KS Lawrence.
 *
 * before or after the manager's words, so the proposal readers find the
 * employee, the salon and the date again. Those lines are not the manager's
 * words. The Job title reader ran "Job title: CA." into the next sentence
 * ("CA. It happened"), and the Observation of Offense copied
 * "It happened at NE Grand Island." as if the manager had written it.
 *
 * A line counts as the app's only when every sentence on it is one of these
 * shapes. A manager line that also says something else is left alone.
 */

const AMOUNT = String.raw`\$?\d[\d,]*(?:\.\d+)?`;

const SHAPES = [
  String.raw`The form is the [^.\n]+\.`,
  String.raw`The employee is [^.\n]+\.`,
  String.raw`Job title: [^.\n]+\.`,
  String.raw`It happened at [^.\n]+\.`,
  String.raw`It happened on [^.\n]+\.`,
  String.raw`Warning level: [^.\n]+\.`,
  String.raw`Payroll deduct applies\.`,
  String.raw`No payroll deduction\.`,
  String.raw`Payroll deduction of ${AMOUNT}\.`,
  String.raw`Payroll deduction amount: ${AMOUNT}\.`,
  String.raw`Payroll amount: ${AMOUNT}\.`,
  String.raw`Policy reference: [^\n]*?JBA Policy Manual(?: p\.\d+)?\.`,
  String.raw`Incident: [^.\n]+\.`,
];

function appSentencePattern(): RegExp {
  return new RegExp(SHAPES.map((shape) => `(?:${shape})`).join("|"), "g");
}

/** True when every sentence on the line is one the app writes. */
export function isAppLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return trimmed.replace(appSentencePattern(), "").trim() === "";
}

/** The text with the app's own lines removed. */
export function withoutAppLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !isAppLine(line))
    .join("\n");
}

/**
 * The text with each sentence of an app line on a line of its own, so a
 * reader that runs to the end of a line stops at the end of the sentence.
 */
export function appSentencesOnePerLine(text: string): string {
  return text
    .split("\n")
    .flatMap((line) => (isAppLine(line) ? (line.match(appSentencePattern()) ?? []).map((part) => part.trim()) : [line]))
    .join("\n");
}
