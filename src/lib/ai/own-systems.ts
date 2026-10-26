import { STC_BRAND } from "@/lib/brand";
import { ownSystemsFactEnabled } from "@/lib/config/chat-quality-flags";

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

/** "isn't your system", "not this company's platform", "is not used here", "another company's". */
const DISOWNS =
  /\b(?:isn'?t|is\s+not|not)\s+(?:your|our|this\s+company'?s|the\s+company'?s)\s+(?:own\s+)?(?:system|platform|tool|app|software|program)\b|\b(?:isn'?t|is\s+not|not)\s+used\s+(?:here|by\s+(?:you|your|us|our|this))\b|\b(?:another|a\s+different|a\s+sister|the\s+sister)\s+(?:brand|company)'?s\b/i;
/** "it's Acme Fitness's", "belongs to Acme Fitness": another company named as its owner. */
const OWNER = /\b(?:(?:it'?s|[Ii]t\s+is)\s+((?:[A-Z][\w&]*\s+){0,3}[A-Z][\w&]*?)'s\b|belongs?\s+to\s+((?:[A-Z][\w&]*\s*){1,4}))/g;
/** This company's own names, which are never "another company". */
const OWN_NAMES = [STC_BRAND.brandName, STC_BRAND.operatorName, STC_BRAND.productName].map((name) => name.toLowerCase());

function namesAnotherOwner(sentence: string): boolean {
  for (const match of sentence.matchAll(OWNER)) {
    const owner = (match[1] ?? match[2] ?? "").trim().toLowerCase();
    if (owner === "" || OWN_SYSTEMS.some((system) => system.pattern.test(owner))) continue;
    if (!OWN_NAMES.some((name) => name.startsWith(owner) || owner.startsWith(name))) return true;
  }
  return false;
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
    if (system && (DISOWNS.test(part) || namesAnotherOwner(part))) {
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
