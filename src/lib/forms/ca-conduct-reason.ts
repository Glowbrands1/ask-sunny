import { caProcedureBasisEnabled, caSalesPolicyEnabled } from "@/lib/config/chat-quality-flags";

import { cleaningUndonePhrase, isSalesPolicyReading, STANDARDS_OF_CONDUCT, type CaPolicyReading } from "./ca-policy";
import { managerIssueWords } from "./other-write-in";

/**
 * ============================================================================
 * THE STANDARDS OF CONDUCT NEEDS A REASON IN THE MANAGER'S WORDS
 * (CA_SALES_POLICY_ENABLED, default off; Pau, 4 Nov 2026, 16:50 UTC)
 * ============================================================================
 *
 * "make a corrective action for <name>, the tanning beds were left dirty at
 * close" came back with Standards of Conduct ticked and cited (p.12, "Failing
 * to follow the policies and procedures"): the drafting model reads cleaning
 * as unfinished assigned work, and revision 8 left the Standards of Conduct
 * as the only conduct box. Pau: a cleaning Corrective Action does not cite
 * the Standards of Conduct by default; wrong items rung up does.
 *
 * So, with the flag on, a Standards of Conduct tick moves to Other — with
 * what happened in the manager's own words beside it (`managerIssueWords`)
 * where the version has the write-in, "Other" alone where it does not
 * (this app's revision 8) — so Policy Violated cites no Standards of Conduct — only when the drafting
 * model's own basis (`offense_basis`, an optional field of the existing draft
 * call) is "upkeep_or_task" AND no reader finds a reason in the manager's
 * words:
 *   - a policy the manager named, the card's section, or a manual section
 *     their account describes (`stated`), or a specific manual topic
 *     (`specific`, e.g. Animals in the Workplace);
 *   - the sales / MSB reading (`isSalesPolicyReading`);
 *   - a conduct topic other than the general "task" one (a direction not
 *     followed, a deadline, cash, an acknowledgement — `readCaPolicy`).
 * With no basis the model's tick stands, as before the flag: no reader tells
 * a cleaning duty from Woven training past due, or a guest treated rudely
 * from no reason at all.
 * One exception (Pau's cleaning ruling, QA sf-s15, 5 Nov 2026): the cleaning
 * reader (`cleaningUndonePhrase`) does tell a cleaning duty apart, so when the
 * model sends no basis, cleaning in the manager's words is the upkeep basis. The prompt is unchanged. Off, or on a version with
 * no Other box, nothing changes.
 */

const OTHER = "other";
const OTHER_WRITE_IN = "other_offense";

/** True when the manager's words give the Standards of Conduct a reason. */
export function conductHasReason(reading: CaPolicyReading, stated: boolean, basis: OffenseBasis | null = null): boolean {
  if (stated || isSalesPolicyReading(reading) || reading.topics.some((topic) => topic !== "task")) return true;
  /*
   * ONLY THE DRAFTING MODEL'S OWN "UPKEEP" MOVES THE TICK. No reader tells a
   * cleaning duty from Woven training past due (both the general "task"
   * reading) or from a guest treated rudely (no reading at all), and those
   * keep the Standards of Conduct (Pau, 22 Oct; QA, 26 Oct). So the tick
   * stands unless the model's basis is upkeep_or_task; with no basis, as
   * before this flag.
   */
  if (basis === "upkeep_or_task") return false;
  // CA_PROCEDURE_BASIS_ENABLED (sf-b6): a store procedure the model names is no reason either.
  return !(caProcedureBasisEnabled() && basis === PROCEDURE_BASIS);
}

/*
 * THE DRAFTING MODEL'S OWN READING OF THE ACCOUNT (Pau, 4 Nov 2026: "rang up
 * the wrong items" keeps the Standards of Conduct; cleaning goes to Other).
 * No reader tells the two apart, so the existing draft call's tool carries one
 * optional field, added with the flag (`OFFENSE_BASIS_PROPERTY`): only
 * upkeep_or_task moves the tick; sales, MSB, conduct, other or no answer
 * keep it. No extra call, no word list in the code.
 */
export const OFFENSE_BASES = ["sales", "msb", "conduct", "upkeep_or_task", "other"] as const;
export type OffenseBasis = (typeof OFFENSE_BASES)[number] | "store_procedure";

/** The tool's optional property, added with CA_SALES_POLICY_ENABLED on a form offering Other. */
export const OFFENSE_BASIS_PROPERTY = {
  type: "string",
  enum: [...OFFENSE_BASES],
  description:
    "Corrective Action only: what the manager's account is about. sales = ringing up a sale inaccurately, or sales performance or goals; msb = Must See Behaviors; conduct = a manager's direction not followed, how the employee treated guests or co-workers, or required training, Woven items, acknowledgements or deadlines not completed; upkeep_or_task = cleaning or store upkeep left undone; other = none of these.",
} as const;

/*
 * CA_PROCEDURE_BASIS_ENABLED (Pau via QA, 5 Nov 2026, sf-b6; default off):
 * "counting the drawer early and turning away a customer" — closing a
 * register before close — came back with Standards of Conduct ticked and its
 * section quoted, though the chat had told the manager no source states a
 * policy for it and it would leave that field to them. Pau chose the narrow
 * rule: like upkeep, a store procedure the drafting model names as the basis
 * moves its Standards of Conduct tick to Other when no reader of the
 * manager's words gives a reason. "Rude to a guest" stays conduct. The enum
 * value and its line in the description are sent only with the flag on.
 */
export const PROCEDURE_BASIS = "store_procedure";

/** The values the tool may send: with CA_PROCEDURE_BASIS_ENABLED, the store-procedure basis too. */
function offenseBases(): readonly string[] {
  return caProcedureBasisEnabled() ? [...OFFENSE_BASES, PROCEDURE_BASIS] : OFFENSE_BASES;
}

/** The tool's optional property as sent: `OFFENSE_BASIS_PROPERTY`, or with CA_PROCEDURE_BASIS_ENABLED its store-procedure value. */
export function offenseBasisProperty(): { readonly type: "string"; readonly enum: readonly string[]; readonly description: string } {
  if (!caProcedureBasisEnabled()) return OFFENSE_BASIS_PROPERTY;
  return {
    type: "string",
    enum: offenseBases(),
    description: `${OFFENSE_BASIS_PROPERTY.description} store_procedure = an opening, closing or register procedure not followed, such as closing early.`,
  };
}

/** The basis the tool call carried, or null when missing or not one of the values. */
export function readOffenseBasis(input: unknown): OffenseBasis | null {
  const value = input && typeof input === "object" ? (input as { offense_basis?: unknown }).offense_basis : undefined;
  return typeof value === "string" && offenseBases().includes(value) ? (value as OffenseBasis) : null;
}

/**
 * The draft with an unreasoned Standards of Conduct tick moved to Other, or
 * null when nothing changes.
 */
export function withoutUnreasonedConduct<T extends { values: Record<string, string>; checked: Record<string, string[]> }>(input: {
  readonly draft: T;
  readonly reading: CaPolicyReading | null;
  readonly stated: boolean;
  readonly offered: readonly string[];
  readonly notes: string;
  /** The drafting model's `offense_basis`, or null. */
  readonly basis?: OffenseBasis | null;
  /** A specific manual topic the manager's words describe (`specificTopic`, e.g. Animals in the Workplace): a reason. */
  readonly specific?: boolean;
  /**
   * True when this form version has the Other write-in (`other_offense`).
   * The current revision does not ("Other prints just Other", Pau): nothing is written
   * there, so Policy Violated reads "Other".
   */
  readonly writeInOffered?: boolean;
}): T | null {
  if (!(caSalesPolicyEnabled() || caProcedureBasisEnabled()) || !input.reading) return null;
  const ticked = input.draft.checked.offense_type ?? [];
  if (!ticked.includes(STANDARDS_OF_CONDUCT) || !input.offered.includes(OTHER)) return null;
  /*
   * Pau's cleaning ruling (QA sf-s15, 5 Nov 2026): when the drafting model sends no basis, cleaning
   * left undone in the manager's words (`cleaningUndonePhrase`, the existing reader) is the upkeep basis.
   */
  const basis = input.basis ?? (cleaningUndonePhrase(input.notes) !== null ? "upkeep_or_task" : null);
  if (input.specific || conductHasReason(input.reading, input.stated, basis)) return null;
  const rest = ticked.filter((key) => key !== STANDARDS_OF_CONDUCT);
  const words = managerIssueWords(input.notes);
  const written = !input.writeInOffered || (input.draft.values[OTHER_WRITE_IN] ?? "").trim() !== "";
  return {
    ...input.draft,
    checked: { ...input.draft.checked, offense_type: rest.includes(OTHER) ? rest : [...rest, OTHER] },
    values: words && !written ? { ...input.draft.values, [OTHER_WRITE_IN]: words } : input.draft.values,
  };
}
