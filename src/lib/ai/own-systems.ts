import { STC_BRAND } from "@/lib/brand";
import { ownSystemsFactEnabled } from "@/lib/config/chat-quality-flags";

import { EXCLUDED_BRAND } from "./full-manual-context";

/**
 * ============================================================================
 * THE COMPANY'S OWN SYSTEMS ARE NEVER CALLED ANOTHER COMPANY'S
 * (OWN_SYSTEMS_FACT_ENABLED)
 * ============================================================================
 *
 * QA tester, 26 Oct 2026 (conv_mvolizr326baln0): "do employees have to
 * acknowledge policies in woven" was answered "Short answer: Woven isn't your
 * system — it's Crunch Fitness's." The manual's lists of where each brand
 * keeps personnel files name Woven beside another brand, and the model read
 * that as Woven not being this company's. It is: the company uses Woven and
 * this app syncs with it. The fact line says only that (QA: nothing the
 * sources do not say).
 *
 * Two parts, the same in both apps (each with its own company's systems):
 *
 *   THE FACT      one line after the excerpts, when the question or the
 *                 excerpts name the system: the company uses it, and a brand
 *                 list in the manual does not make it another company's.
 *   THE BACKSTOP  a reply sentence that still says the system is not this
 *                 company's ("isn't your system", "it's <another brand>'s")
 *                 is taken out; every other sentence is kept.
 *
 * Off, the grounding and the reply are as before.
 */

interface OwnSystem {
  readonly name: string;
  /** Matches the name as typed. */
  readonly pattern: RegExp;
}

/** This company's systems that the manual also lists beside other brands. */
const OWN_SYSTEMS: readonly OwnSystem[] = [
  { name: "Woven", pattern: /\bwoven\b/i },
];

/** The fact line for every own system the question or the excerpts name, or null. */
export function ownSystemsNote(question: string, grounding: string): string | null {
  if (!ownSystemsFactEnabled()) return null;
  const named = OWN_SYSTEMS.filter((system) => system.pattern.test(question) || system.pattern.test(grounding));
  if (named.length === 0) return null;
  return named
    .map(
      (system) =>
        `${factLine(system).slice(0, -1)}, and this app syncs with it. A manual list that names ${system.name} beside another brand does not make it another company's system: never tell the manager ${system.name} is not theirs.`,
    )
    .join("\n");
}

/**
 * WHAT DISOWNS THE SYSTEM, ABOUT THE SYSTEM (QA-5, 26 Oct 2026): the phrase
 * follows the system's name in the same clause ("Woven isn't your system"),
 * and "another owner" is one of the other brands the manual lists
 * (`EXCLUDED_BRAND`), never any capitalised word. "Paycor is not your system
 * for scheduling; Woven is.", "Woven belongs to HR." and "Woven doesn't
 * handle payroll; it's Paycor's." are kept.
 */
function disowns(clause: string, system: OwnSystem): boolean {
  const name = system.pattern.source;
  const lead = String.raw`${name}\s+(?:\S+\s+){0,2}?`;
  const notOurs = new RegExp(
    String.raw`${lead}(?:isn'?t|is\s+not|not)\s+(?:your|our|this\s+company'?s|the\s+company'?s)\s+(?:own\s+)?(?:system|platform|tool|app|software|program)\b|${lead}(?:isn'?t|is\s+not)\s+used\s+(?:here|by\s+(?:you|your|us|our|this))\b|${lead}(?:is|belongs\s+to)\s+(?:another|a\s+different|a\s+sister|the\s+sister)\s+(?:brand|company)`,
    "i",
  );
  const otherOwner = new RegExp(
    String.raw`${name}[^.;]{0,60}?(?:\bit'?s|\bit\s+is|\bbelongs?\s+to|\bis\s+(?:only\s+)?(?:for|used\s+by))\s+(?:the\s+)?(?:${EXCLUDED_BRAND.source})`,
    "i",
  );
  return notOurs.test(clause) || otherOwner.test(clause);
}

function factLine(system: OwnSystem): string {
  return `${STC_BRAND.brandName} uses ${system.name}.`;
}

/** The reply without a sentence saying one of the company's own systems is not its own. Off, the reply as given. */
export function withoutDisownedSystems(reply: string): string {
  if (!ownSystemsFactEnabled() || !reply) return reply;
  const parts = reply.split(/(?<=[.!?])(\s+)|(\n)/);
  const dropped: OwnSystem[] = [];
  const out: string[] = [];
  for (const part of parts) {
    if (part === undefined) continue;
    const system = OWN_SYSTEMS.find((entry) => entry.pattern.test(part));
    // Each clause on its own: "Paycor is not your system; Woven is." disowns nothing.
    if (system && part.split(/;|\bbut\b/).some((clause) => disowns(clause, system))) {
      if (!dropped.includes(system)) dropped.push(system);
      continue;
    }
    out.push(part);
  }
  if (dropped.length === 0) return reply;
  const kept = out.join("").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  // A reply that was only that claim gets the fact instead.
  return kept.length > 0 ? kept : dropped.map(factLine).join(" ");
}
