import { accountPersonNotSubjectEnabled } from "@/lib/config/chat-quality-flags";

/*
 * ============================================================================
 * A PERSON NAMED IN A ROLE INSIDE THE ACCOUNT IS NOT THE FORM'S SUBJECT (ACCOUNT_PERSON_NOT_SUBJECT_ENABLED)
 * ============================================================================
 *
 * QA's J11 (15 Nov 2026): "<B> completed onboarding with new hire <C> on 9-28-26. As of 10-16-26 <C> had not
 * acknowledged …" — <C> is part of what <B> did, not who the form is about. A name the message gives a role (a new
 * hire, a witness, a guest, a customer, a coworker, a trainee), and that person's first name alone in the same message,
 * is set aside by the person reader (`proposal.ts` employeeState) while someone else is the subject. Pure.
 */

const ROLE = String.raw`(?:new\s+hires?|hires?|witness(?:es)?|guests?|customers?|clients?|co-?workers?|trainees?|team\s+members?)`;

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

/** The names this message gives a role ("new hire Corran Vale"), as the reader read them. Off, none. */
export function roleNamedPeople(text: string, names: readonly string[]): string[] {
  if (!accountPersonNotSubjectEnabled()) return [];
  const inRole = names.filter((name) => new RegExp(String.raw`\b${ROLE}\s+(?:named\s+|called\s+)?${escaped(name)}\b`, "i").test(text));
  const firsts = new Set(inRole.map((name) => name.trim().split(/\s+/)[0]!.toLowerCase()));
  // The same person's first name alone later in the message ("As of 10-16-26 Corran had not …").
  return names.filter((name) => inRole.includes(name) || (name.trim().split(/\s+/).length === 1 && firsts.has(name.trim().toLowerCase())));
}
