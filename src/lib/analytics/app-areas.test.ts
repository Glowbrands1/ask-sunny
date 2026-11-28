import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ACTIVITY_FEATURES, CATEGORY_FEATURE, featureLabel } from "./taxonomy";

/*
 * Pau, 28 Nov 2026: "add usage for the L10 all meetings and the form monitoring as well pls , and list all users per
 * name and backfill it please not just by title", then "also add ai training" and "add google reviews too and
 * calendar". Before this, none of the five areas reached the Analytics page: opening them left no row, and
 * activity_unified did not read what they record.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const view = read("supabase/migrations/20261128001100_app_usage_days.sql");

const AREAS = [
  ["l10", "L10 Meetings", "src/app/(app)/meetings/[key]/page.tsx"],
  ["form_monitoring", "Form Monitoring", "src/app/(app)/forms/monitoring/page.tsx"],
  ["ai_training", "AI Training", "src/app/(app)/ai-training/page.tsx"],
  ["google_reviews", "Google Reviews", "src/app/(app)/reviews/page.tsx"],
  ["calendar", "Calendar", "src/app/(app)/calendar/page.tsx"],
] as const;

describe("the five areas are counted on the Analytics page", () => {
  it.each(AREAS)("%s is a feature with its own label and category", (area, label) => {
    expect(ACTIVITY_FEATURES).toContain(area);
    expect(featureLabel(area)).toBe(label);
    expect(Object.values(CATEGORY_FEATURE)).toContain(area);
  });

  it.each(AREAS)("opening %s records a day of use", (area, _label, page) => {
    expect(read(page)).toMatch(new RegExp(`noteAppUsage\\(identity, "${area}"`));
    expect(view).toContain(`'${area}'`);
  });

  it("counts every day of use as one event, in the view production reads", () => {
    expect(view).toContain("create or replace view public.activity_unified");
    expect(view).toContain("from public.app_usage_days u");
    expect(view).toContain("primary key (user_id, area, detail, day)");
  });

  it("backfills what the areas already record: Form Monitoring actions, AI Training submissions, Calendar reminders", () => {
    expect(view).toContain("from public.form_instance_events ev");
    expect(view).toMatch(/'archived', 'unarchived', 'follow_up_started'/);
    expect(view).toContain("from public.ai_training_submissions ts");
    expect(view).toContain("from public.calendar_reminders cr");
  });

  it("does not count a Form Monitoring action on a form still with HR (20261123002000)", () => {
    const branch = view.split("from public.form_instance_events ev")[1].split("union all")[0];
    expect(branch).toContain("fi.hr_approval_state is null or fi.hr_approval_state = 'approved'");
  });

  it("keeps the restated view's earlier branches (forms, documents, reports)", () => {
    expect(view).toContain("'forms'::public.activity_feature as feature");
    expect(view).toContain("from public.knowledge_documents d");
    expect(view).toContain("from public.report_ingestions r");
    expect(view).toContain("and (i.hr_approval_state is null or i.hr_approval_state = 'approved')");
  });

  it("lists every person by name with their figures per area", () => {
    const screen = read("src/features/admin/analytics/analytics-screen.tsx");
    expect(screen).toContain('title="Usage by person"');
    expect(read("src/lib/analytics/queries.ts")).toContain('supabase.rpc("analytics_people_features", args)');
  });
});
