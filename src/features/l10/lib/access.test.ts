import { describe, expect, it } from "vitest";
import { NOT_ATTENDEE, NOT_ATTENDEE_FOR_MODEL, meetingNamed } from "./access";

describe("attendee-only meetings (the owner, 27 Nov 2026)", () => {
  it('says exactly "You are not an attendee of this meeting"', () => {
    expect(NOT_ATTENDEE).toBe("You are not an attendee of this meeting");
    expect(NOT_ATTENDEE_FOR_MODEL.startsWith(`${NOT_ATTENDEE}.`)).toBe(true);
  });
  it("knows a real meeting by the name a manager uses, and nothing else", () => {
    expect(meetingNamed("the Leadership L10")).toBe("leadership");
    expect(meetingNamed("STC DM L10")).toBe("stc-dm");
    expect(meetingNamed("maintenance")).toBe("maintenance");
    expect(meetingNamed("Budget sync")).toBeNull();
    expect(meetingNamed("")).toBeNull();
    expect(meetingNamed("DM")).toBeNull();
  });
});
