import { expect, vi } from "vitest";

import { EXCLUDED_BRAND } from "@/lib/ai/full-manual-context";
import { ACTIVE_BRAND } from "@/lib/brand";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * ONLY THIS COMPANY'S BRAND IN A REPLY (Pau, 6 Nov 2026; OWN_BRAND_ONLY_ENABLED)
 * ============================================================================
 *
 * The sibling app's live reply said "This applies company-wide across all
 * brands — <its brand>, <two other brands> — pets are not allowed…"; Pau:
 * only its own brand. This app's mirror: the answering model writes the
 * sentence with this brand first; the other brands are read from the manual
 * block's own pattern, never written here.
 */

const titled = (name: string) => name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
const OTHERS = EXCLUDED_BRAND.source
  .replace(/^\\b\(\?:|\)\\b$/g, "")
  .split("|")
  .filter((alternative) => !/office/.test(alternative))
  .map((alternative) => titled(alternative.replace(/\(\?:[^)]*\)\?/g, "")));
const OWN = ACTIVE_BRAND.brandName;

export const NOV6_OWN_BRAND_ONLY_CASES: ReplayCase[] = [
  {
    id: "nov6-own-brand-only-pets",
    title: "a policy answer listing every brand (\"across all brands — …\") names only this company's brand",
    report: "Pau, 6 Nov 2026 (relayed by QA), the mirror of the sibling app's live reply",
    status: { open: "the reply lists the other brands" },
    fixFlags: ["OWN_BRAND_ONLY_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      t.modelSays(`This applies company-wide across all brands — ${OWN}, ${OTHERS.join(", ")} — pets are not allowed in the workplace [p.29].`);
      const reply = await thread.say("can employees bring their dog to work?");
      for (const other of OTHERS) expect(reply.content, `the reply names another brand:\n${reply.content}`).not.toContain(other);
      expect(reply.content, `the reply lost the policy:\n${reply.content}`).toMatch(new RegExp(`at ${OWN} — pets are not allowed`));
    },
  },
];
