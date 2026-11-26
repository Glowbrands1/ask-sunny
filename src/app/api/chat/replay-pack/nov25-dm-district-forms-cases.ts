import { expect, vi } from "vitest";

import { PRODUCTION_DISTRICTS, PRODUCTION_SALONS } from "@/data/salons";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A DISTRICT MANAGER'S CHAT READS THE FORMS THEIR SALONS' MANAGERS FILE
 * ============================================================================
 *
 * Pau, 25 Nov 2026: "are Dms able to see the forms that their managers are submitting?" — then "there is in sunny
 * though?" (the district-to-salon map, `PRODUCTION_SALONS`) and "i need this in sunny please".
 *
 * Before: a `district` scope (set in User Management) named no salon for Forms, so a DM's FORMS ON FILE block held only
 * the salons Woven assigns them — none, for a DM Woven places at an office. Now the scope reads the roster's salons of
 * that district, as Reporting does (`forms/location-scope.ts`, `forms/forms-visibility.ts`).
 *
 * The salons come from the roster rather than being typed here; the people are invented.
 */

const REPORT = 'Pau, 25 Nov 2026: "are Dms able to see the forms that their managers are submitting?" ... "i need this in sunny please"';

const DISTRICT = PRODUCTION_DISTRICTS[0]!;
const IN_DISTRICT = PRODUCTION_SALONS.find((salon) => salon.districtId === DISTRICT.id)!;
const OUTSIDE = PRODUCTION_SALONS.find((salon) => salon.districtId !== DISTRICT.id)!;
const DM_SCOPE = { level: "district", primaryAreaId: DISTRICT.id, alsoCoversAreaIds: [] };

function onFile(t: ReplayContext): void {
  const forms = t.forms() as Record<string, unknown>[];
  const put = (id: string, salon: typeof IN_DISTRICT, employee: string) =>
    forms.push({
      id,
      template_id: "t",
      template_version_id: "v",
      variant_key: null,
      employee_role: null,
      location_id: salon.id,
      location_name: salon.name,
      created_by: "a-salon-director",
      created_by_role: "salon_director",
      source: "ask_sunny",
      status: "finalized",
      follow_up_date: null,
      archived_at: null,
      revises_instance_id: null,
      template_key: "dpoa",
      template_name: "Corrective Action Form",
      employee_name: employee,
      form_date: "2026-11-20",
      created_at: "2026-11-20T15:00:00Z",
      updated_at: "2026-11-20T15:00:00Z",
    });
  put("nov25-dm-in-district", IN_DISTRICT, "Marlowe Quintrell");
  put("nov25-dm-outside-district", OUTSIDE, "Thessaly Brookhaven");
}

export const NOV25_DM_DISTRICT_FORMS_CASES: ReplayCase[] = [
  {
    id: "nov25-dm-district-scope-reads-district-forms",
    title: "a District Manager (district scope, no Woven salon) asks \"who got a CA this month?\": the CA a salon director filed in their district reaches the model; one filed outside the district does not",
    report: REPORT,
    status: "fixed",
    async run(t) {
      vi.setSystemTime(new Date("2026-11-25T18:00:00Z"));
      t.directory(STAFF);
      t.as("district_manager", DM_SCOPE);
      onFile(t);
      t.modelSays("Here are this month's corrective actions.");
      await t.thread().say("who got a CA this month?");
      const block = t.lastFormRecords?.() ?? "";
      expect(block, block).toContain("Marlowe Quintrell");
      expect(block).not.toContain("Thessaly Brookhaven");
    },
  },
  {
    id: "nov26-dm-whole-company-reads-district-forms",
    title: "a District Manager whose account is still on \"whole company\" asks \"who got a CA this month?\": the roster names her on the district, so its CA reaches the model and one outside it does not",
    report: 'Pau, 26 Nov 2026: "she should though" ... "rachel and sarah all district her salon and other salon and her managers forms"',
    status: "fixed",
    async run(t) {
      vi.setSystemTime(new Date("2026-11-25T18:00:00Z"));
      t.directory(STAFF);
      const [last, first] = DISTRICT.name.split(",").map((part) => part.trim());
      t.addRows!("app_users", [
        { id: "nov26-dm", email: `${first}.${last}@example.com`, display_name: first, status: "active" },
      ]);
      t.as("district_manager", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] }, "nov26-dm");
      onFile(t);
      t.modelSays("Here are this month's corrective actions.");
      await t.thread().say("who got a CA this month?");
      const block = t.lastFormRecords?.() ?? "";
      expect(block, block).toContain("Marlowe Quintrell");
      expect(block).not.toContain("Thessaly Brookhaven");
    },
  },
];
