import { describe, expect, it } from "vitest";

import { readCaPolicy } from "./ca-policy";

/**
 * ============================================================================
 * A MEETING NOT ATTENDED, IN WORDS NOBODY WROTE A RULE FOR — QA, 22 OCT 2026
 * ============================================================================
 *
 * The reading has to recognise the situation, not a sentence. None of these
 * is the wording the reading was written from ("for not attending the monthly
 * meeting"). The negatives are the near misses: the event as the setting of
 * something else, a late arrival, work that was not done.
 */

describe("recognised however the manager says it", () => {
  it.each([
    ["violet was a no-show at the all-staff on 10/20", "all-staff"],
    ["she didn't make it to Tuesday's team meeting", "team meeting"],
    ["she skipped out on the monthly mtg", "monthly mtg"],
    ["she wasn't at the store meeting last monday", "store meeting"],
    ["blew off the required training session on 10-20", "required training session"],
    ["failed to show for the 10-20 manager meeting", "10-20 manager meeting"],
    ["missed our monthly huddle", "monthly huddle"],
    ["she never showed up for the webinar", "webinar"],
    ["she was absent from the monthly meeting", "monthly meeting"],
    ["didn't attend mandatory training on 10/20", "mandatory training"],
    ["she bailed on the meeting with no explanation", "meeting"],
    ["no call no show to the monthly meeting", "monthly meeting"],
    ["she did not log in to the webinar", "webinar"],
    ["the monthly meeting on 10-20, which she missed", "monthly meeting"],
    ["monthly meeting 10-20-26 - did not attend", "monthly meeting"],
    ["she missed her 1:1 with me", "1:1"],
    ["never came to orientation", "orientation"],
    ["violet did not come to the meeting even though it was on the schedule", "meeting"],
  ])("%s", (text, event) => {
    const reading = readCaPolicy(text);
    expect(reading.missedEvent).toBe(event);
  });
});

describe("not a meeting missed", () => {
  it.each([
    "she was on her phone during the monthly meeting",
    "she was rude to a coworker at the meeting",
    "she missed the woven training deadline",
    "she didn't complete her training modules",
    "she was 20 minutes late to the monthly meeting",
    "she left the meeting early",
    "she didn't speak up in the meeting",
    "she missed questions on the training quiz",
    "she skipped her cleaning tasks before the meeting",
    "she attended the meeting but did not take notes",
    "she missed the deadline we set at the meeting",
  ])("%s", (text) => {
    expect(readCaPolicy(text).missedEvent).toBeNull();
  });
});
