import { payrollAmountFieldEnabled } from "@/lib/config/chat-quality-flags";
import { rosterSalonName } from "@/lib/forms/salon-mention";
import type { ChatFormProposal } from "@/types";

/**
 * What this conversation has already settled for a form.
 *
 * Read onto the next question before anything is asked again. A missing
 * table leaves the question as it was; the store swallows that error.
 */

export interface ConversationFormState {
  readonly employeeId: string | null;
  readonly employeeName: string | null;
  readonly keptTypedName: string | null;
  readonly salonId: string | null;
  readonly title: string | null;
  readonly formDate: string | null;
  readonly warningLevel: "verbal" | "written" | null;
  readonly payrollDeduct: "yes" | "no" | null;
  readonly policyHeading: string | null;
  readonly policyPage: number | null;
  readonly templateKey: string | null;
  readonly incident: string | null;
  /** A manual heading this conversation already grounded, or null. */
  readonly incidentType: string | null;
  /** A payroll figure this conversation already grounded, or null. */
  readonly payrollAmount: string | null;
  /**
   * Payroll deduction amount, the manager's figure. Kept across a redraft.
   * Not the intent slot above, and not a figure read out of a policy.
   */
  readonly payrollDeductAmount: string | null;
}

export const EMPTY_FORM_STATE: ConversationFormState = {
  employeeId: null,
  employeeName: null,
  keptTypedName: null,
  salonId: null,
  title: null,
  formDate: null,
  warningLevel: null,
  payrollDeduct: null,
  policyHeading: null,
  policyPage: null,
  templateKey: null,
  incident: null,
  incidentType: null,
  payrollAmount: null,
  payrollDeductAmount: null,
};

/**
 * A salon whose name contains "and" ("NE Omaha 132nd and Maple") is split into
 * a person once any turn is read as a correction. The salon number is the
 * same salon, and the name reader does not take its last word.
 */
function salonForReaders(name: string, salonId: string): string {
  if (!/\band\b/i.test(name)) return name;
  const number = salonId.replace(/^loc-/, "");
  return number ? `salon ${number}` : name;
}

export function stateSentences(state: ConversationFormState): string[] {
  const lines: string[] = [];
  if (state.employeeName) lines.push(`The employee is ${state.employeeName}.`);
  if (state.title) lines.push(`Job title: ${state.title}.`);
  if (state.salonId) {
    const salon = rosterSalonName(state.salonId);
    if (salon) lines.push(`It happened at ${salonForReaders(salon, state.salonId)}.`);
  }
  if (state.formDate) lines.push(`It happened on ${slashDate(state.formDate)}.`);
  if (state.warningLevel) lines.push(`Warning level: ${state.warningLevel}.`);
  if (state.payrollDeduct === "yes") lines.push("Payroll deduct applies.");
  if (state.payrollDeduct === "no") lines.push("No payroll deduction.");
  if (state.policyHeading) {
    const page = state.policyPage && state.policyPage > 0 ? ` p.${state.policyPage}` : "";
    lines.push(`Policy reference: ${state.policyHeading}, JBA Policy Manual${page}.`);
  }
  if (state.incidentType) lines.push(`Incident: ${state.incidentType}.`);
  if (state.payrollAmount) lines.push(`Payroll amount: ${state.payrollAmount}.`);
  if (payrollAmountFieldEnabled() && state.payrollDeductAmount) {
    lines.push(`Payroll deduction amount: ${state.payrollDeductAmount}.`);
  }
  return lines;
}

/** Sentences the proposal readers already accept, ahead of this turn's words. */
export function prependFormState(question: string, state: ConversationFormState | null): string {
  if (!state) return question;
  const lines = stateSentences(state).filter((line) => !question.includes(line));
  if (lines.length === 0) return question;
  return `${lines.join(" ")}\n${question}`;
}

export function captureFormState(
  previous: ConversationFormState | null,
  input: {
    readonly proposal: ChatFormProposal | null;
    readonly employeeId: string | null;
    readonly keptTypedName: string | null;
    readonly userText: string;
    readonly policyHeading: string | null;
    readonly policyPage: number | null;
  },
): ConversationFormState {
  const prior = previous ?? EMPTY_FORM_STATE;
  const proposal = input.proposal;
  const named = proposal?.employeeName?.trim() || null;
  const samePerson =
    named !== null && prior.employeeName !== null && named.toLowerCase() === prior.employeeName.toLowerCase();
  const incident = input.userText.trim().slice(0, 500);
  return {
    employeeId: named ? (input.employeeId ?? (samePerson ? prior.employeeId : null)) : prior.employeeId,
    employeeName: named ?? prior.employeeName,
    keptTypedName: input.keptTypedName ?? prior.keptTypedName,
    salonId: proposal?.locationId ?? prior.salonId,
    title: proposal?.employeeRole?.trim() || prior.title,
    formDate: proposal?.formDate ?? prior.formDate,
    warningLevel: proposal?.warningLevel ?? prior.warningLevel,
    payrollDeduct: proposal?.payrollDeduct ?? prior.payrollDeduct,
    policyHeading: input.policyHeading ?? prior.policyHeading,
    policyPage: input.policyPage ?? prior.policyPage,
    templateKey: proposal?.templateKey ?? prior.templateKey,
    incident: incident || prior.incident,
    incidentType: prior.incidentType,
    payrollAmount: prior.payrollAmount,
    payrollDeductAmount: input.proposal?.payrollDeductAmount ?? prior.payrollDeductAmount,
  };
}

export function parseFormState(value: unknown): ConversationFormState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ConversationFormState>;
  const warning = row.warningLevel === "verbal" || row.warningLevel === "written" ? row.warningLevel : null;
  const payroll = row.payrollDeduct === "yes" || row.payrollDeduct === "no" ? row.payrollDeduct : null;
  return {
    employeeId: textOrNull(row.employeeId),
    employeeName: textOrNull(row.employeeName),
    keptTypedName: textOrNull(row.keptTypedName),
    salonId: textOrNull(row.salonId),
    title: textOrNull(row.title),
    formDate: textOrNull(row.formDate),
    warningLevel: warning,
    payrollDeduct: payroll,
    policyHeading: textOrNull(row.policyHeading),
    policyPage: typeof row.policyPage === "number" && row.policyPage > 0 ? row.policyPage : null,
    templateKey: textOrNull(row.templateKey),
    incident: textOrNull(row.incident),
    incidentType: textOrNull(row.incidentType),
    payrollAmount: textOrNull(row.payrollAmount),
    payrollDeductAmount: textOrNull(row.payrollDeductAmount),
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function slashDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${Number(month)}/${Number(day)}/${year}`;
}
