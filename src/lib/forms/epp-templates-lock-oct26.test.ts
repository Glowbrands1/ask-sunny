import { beforeAll, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

import { WITHHELD_FROM_CHOOSER, offeredInChooser } from "./chooser";
import { TEMPLATE_SEEDS } from "./library";

/**
 * ============================================================================
 * LOCK: ASK SUNNY KEEPS ITS SIX EMPLOYEE PERFORMANCE PLANS (26 OCT 2026)
 * ============================================================================
 *
 * Ask Bubbles carried these six templates over from Sunny with the rest of the
 * library. They are Sunny's own content — the SDIT, TSD, ASD-SDIT and FTTC
 * plans and both DMIT readings — so QA hid them in Bubbles (its
 * `config/company/forms/hidden.ts`, 26 Oct 2026). That decision is
 * Bubbles-only: Sunny-only content stays in Sunny (`docs/parity-log.md`).
 *
 * This locks Sunny's side, so a later port of Bubbles' hidden list cannot take
 * them out of Sunny's library: every one is still seeded, still active after
 * the library is installed, still in `listTemplateSummaries()` (the list the
 * Form Templates page and the chat read) with a published version, and not
 * withheld from the chooser. Sunny has no hidden-template list; its only
 * withholding list is `WITHHELD_FROM_CHOOSER` (`./chooser.ts`), and none of
 * the six is on it.
 */
const EPP_KEYS = ["sdit-epp", "tsd-epp", "asd-sdit-epp", "fttc-epp", "dmit-epp-tsd", "dmit-epp-dmit"] as const;

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
};
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));
const { ensureTemplateLibrary, listTemplateSummaries } = await import("./repository");

describe("Ask Sunny keeps its six EPP templates", () => {
  it("all six are in the library Sunny seeds", () => {
    const keys = TEMPLATE_SEEDS.map((seed) => seed.key);
    for (const key of EPP_KEYS) expect(keys, key).toContain(key);
  });

  it("none is withheld from the chooser", () => {
    for (const key of EPP_KEYS) {
      expect(WITHHELD_FROM_CHOOSER, key).not.toContain(key);
      expect(offeredInChooser(key), key).toBe(true);
    }
  });

  describe("read from the database", () => {
    beforeAll(async () => {
      await ensureTemplateLibrary("system");
    });

    it("each row is active once the library is installed", () => {
      for (const key of EPP_KEYS) {
        expect(store.form_templates!.some((row) => row.key === key && row.active === true), key).toBe(true);
      }
    });

    it("the template list names each one, active, with a published version", async () => {
      const summaries = await listTemplateSummaries();
      for (const key of EPP_KEYS) {
        const summary = summaries.find((entry) => entry.key === key);
        expect(summary, key).toBeDefined();
        expect(summary!.active, key).toBe(true);
        expect(summary!.currentVersion?.status, key).toBe("published");
      }
    });
  });
});
