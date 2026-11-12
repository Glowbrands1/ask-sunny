import { afterEach, describe, expect, it, vi } from "vitest";

import { detectTemplateIntent } from "./template-intent";

// Pau via QA, sf-s22 (5 Nov 2026): the reviewer's notes pasted after "Make this:"; the person invented.
const NOTES =
  "Please make the following edits and resubmit:\n\n1. **Kit Coaching Document:** This was signed on 10/16/2026. Please make sure all coaching documents are signed and dated (mm/dd/yyyy format) before uploading.\n\n2. **Details – Observed:** Please reword this section.";

describe("PASTED_FORM_NAME_NOT_REQUEST_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: \"Kit Coaching Document\" inside the paste reads as a Coaching Form request (the bug)", () => {
    expect(detectTemplateIntent(`Make this:${NOTES}`)).toEqual({ kind: "explicit", templateKey: "coaching" });
  });

  it("on: the form is read from the lead only", () => {
    vi.stubEnv("PASTED_FORM_NAME_NOT_REQUEST_ENABLED", "true");
    expect(detectTemplateIntent(`Make this:${NOTES}`).kind).toBe("none");
    expect(detectTemplateIntent(`Use this to make it: ${NOTES}`).kind).toBe("none");
  });

  it("on: a lead that names the form still asks for it; a turn with no paste is read as before", () => {
    vi.stubEnv("PASTED_FORM_NAME_NOT_REQUEST_ENABLED", "true");
    expect(detectTemplateIntent(`Make a coaching form from this:${NOTES}`)).toEqual({ kind: "explicit", templateKey: "coaching" });
    expect(detectTemplateIntent("create a coaching form for Rowan Kestrel")).toEqual({ kind: "explicit", templateKey: "coaching" });
  });
});
