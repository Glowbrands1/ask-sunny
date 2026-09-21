import { describe, expect, it } from "vitest";

import {
  numberedListLines,
  parseFormDocument,
  parseFormVariants,
  responsibilityMap,
  withNumberedListLine,
} from "./document";
import { TEMPLATE_SEEDS } from "./library";
import { enforcePersonEdit, enforceResponsibilities } from "./responsibility";

/**
 * ============================================================================
 * THE STRUCTURED LISTS THE EDITOR COULD NOT SEE
 * ============================================================================
 *
 * Reported from a live SDIT EPP: the narrative boxes were drafted and the
 * "Overall top three strengths" boxes underneath were empty. The assistant had
 * filled them — `top_strengths` held two lines in `form_instance_values` — and
 * the editor was reading `top_strengths_1`, a key nothing has ever written.
 */

const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "sdit-epp")!;
const document = parseFormDocument(seed.document);
const variant = parseFormVariants(seed.variants)[0]!;

describe("one value, one key, one line per row", () => {
  it("splits a drafted value into the rows the form prints", () => {
    expect(numberedListLines("Strong client service\nPositive atmosphere", 3)).toEqual([
      "Strong client service",
      "Positive atmosphere",
      "",
    ]);
  });

  it("gives every row when the value is empty, so the form still prints its lines", () => {
    expect(numberedListLines(undefined, 2)).toEqual(["", ""]);
    expect(numberedListLines("", 3)).toEqual(["", "", ""]);
  });

  it("keeps a line in the row it was typed into", () => {
    // Filling row 2 first must not move it to row 1 while the cursor is in it.
    expect(withNumberedListLine("", 3, 1, "Punctuality")).toBe("\nPunctuality");
    expect(numberedListLines(withNumberedListLine("", 3, 1, "Punctuality"), 3)).toEqual([
      "",
      "Punctuality",
      "",
    ]);
  });

  it("leaves an untouched list empty rather than newline-only", () => {
    /*
     * "\n\n" is a FILLED value to `enforceResponsibilities`, and would print
     * two blank ruled lines as though somebody had written something.
     */
    expect(withNumberedListLine("", 3, 0, "")).toBe("");
    expect(withNumberedListLine("One\nTwo", 3, 1, "")).toBe("One");
  });

  it("never lets a pasted newline become a second row", () => {
    expect(withNumberedListLine("", 3, 0, "One\nTwo")).toBe("One Two");
  });
});

describe("what the drafted value has to survive", () => {
  const DRAFTED = {
    top_strengths: "Excellent client service and rapport with customers\nPositive presence with clients",
    improvement_areas: "Consistent punctuality — arriving on time and ready to work",
  };

  it("is accepted from the assistant under the block's own key", () => {
    const kept = enforceResponsibilities(document, variant.key, { values: DRAFTED });
    expect(kept.values.top_strengths).toBe(DRAFTED.top_strengths);
    expect(kept.values.improvement_areas).toBe(DRAFTED.improvement_areas);
    expect(kept.rejected).toEqual([]);
  });

  it("is accepted from a PERSON under the same key, which is what was broken", () => {
    /*
     * THE HALF THAT WAS WORSE THAN A BLANK BOX. Typing into row 1 wrote
     * `top_strengths_1`, which is not a field on this version — so the save
     * reported success and `enforcePersonEdit` dropped the value.
     */
    const edited = enforcePersonEdit(document, variant.key, {
      values: { top_strengths: withNumberedListLine(DRAFTED.top_strengths, 3, 2, "Coaches the floor") },
    });
    expect(edited.rejected).toEqual([]);
    expect(numberedListLines(edited.values.top_strengths, 3)[2]).toBe("Coaches the floor");

    const old = enforcePersonEdit(document, variant.key, {
      values: { top_strengths_1: "Strong client service" },
    });
    expect(old.values.top_strengths_1).toBeUndefined();
    expect(old.rejected[0]?.reason).toContain("not a field");
  });

  it("is a key the template version actually declares", () => {
    const keys = responsibilityMap(document, variant.key);
    expect(keys.get("top_strengths")).toBe("ai");
    expect(keys.get("improvement_areas")).toBe("ai");
    expect(keys.has("top_strengths_1")).toBe(false);
  });
});
