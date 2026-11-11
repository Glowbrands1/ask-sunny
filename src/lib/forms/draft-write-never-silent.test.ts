import { describe, expect, it } from "vitest";

import { DRAFT_NOTHING_SAVED_NOTICE, fieldCount, withoutRefused } from "./draft-write-never-silent";

/* DRAFT_WRITE_NEVER_SILENT_ENABLED. The replay case `nov10-draft-write-refused-field-never-drops-the-draft` runs the route. */
describe("a draft write refused as a whole", () => {
  it("is retried without the refused fields only", () => {
    const draft = { values: { coaching_details: "Observed:\nShe missed the monthly meeting.", stray_field: "x" }, checked: { coaching_topics: ["other"] } };
    expect(withoutRefused(draft, ["stray_field"])).toEqual({ values: { coaching_details: "Observed:\nShe missed the monthly meeting." }, checked: { coaching_topics: ["other"] } });
    expect(fieldCount(withoutRefused(draft, ["stray_field", "coaching_details", "coaching_topics"]))).toBe(0);
  });

  it("says plainly that nothing was saved", () => {
    expect(DRAFT_NOTHING_SAVED_NOTICE).toMatch(/^Nothing was saved on this draft/);
  });
});
