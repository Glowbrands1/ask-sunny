import { describe, expect, it } from "vitest";

import { accountPassage } from "./account-passage";

/*
 * Port from Ask Bubbles (fee69631), the chunk as production holds it: "Care and Cleaning of Equipment and Facilities"
 * starts 105 characters into its chunk, after the previous section's tail. With no block that fits the account, the
 * text above a plain heading (another section's) is never quoted.
 */
const HEADING = "Care and Cleaning of Equipment and Facilities";
const TAIL = "the salon phone is for business calls only, and only for sending company-approved messages.".padStart(105, " ");
const CHUNK = { chunkIndex: 21.5, chunkId: "jba-21-5", locator: `Page 21 — ${HEADING}`, page: 22, content: `${TAIL}\n${HEADING}\nEmployees keep the salon, its beds and its equipment clean and sanitized as directed.`, section: HEADING, printedPage: 21, sections: [] };

describe("accountPassage: a plain heading after the previous section's tail", () => {
  it("never quotes the previous section's tail when no block fits", () => {
    expect(accountPassage([CHUNK] as never, { heading: HEADING, chunkIndex: 21.5 }, "Remy did not put trash liners into the trash cans, and laundry was not done.", "Remy Calder")).toBeNull();
  });
  it("quotes the section's own block when it fits", () => {
    expect(accountPassage([CHUNK] as never, { heading: HEADING, chunkIndex: 21.5 }, "Remy left the beds dirty and did not sanitize the equipment.", "Remy Calder")).toMatch(/Employees keep the salon/);
  });
});
