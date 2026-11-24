import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { templateRoutesToHr } from "./hr-approval-rules";

/**
 * OWNER, 24 Nov 2026, verbatim: "No , use \" Finalize and send for approval\" Remember we dont require coaching forms
 * for approval For both apps".
 */
const card = readFileSync(join(process.cwd(), "src/features/chat/inline-form.tsx"), "utf8");
const panel = readFileSync(join(process.cwd(), "src/features/forms/hr-approval-panel.tsx"), "utf8");

describe('"use Finalize and send for approval"', () => {
  it("the card's button and the panel's hint say it, and never the old wording", () => {
    expect(card).toContain('"Finalize and send for approval"');
    expect(panel).toContain("Finalize and send for approval again");
    expect(card + panel).not.toContain("send to HR for approval");
  });
});

describe('"we dont require coaching forms for approval"', () => {
  it("the coaching forms' permission never routes to HR; every other form's does", () => {
    expect(templateRoutesToHr("create_coaching_form")).toBe(false);
    expect(templateRoutesToHr("create_corrective_action")).toBe(true);
  });
});
