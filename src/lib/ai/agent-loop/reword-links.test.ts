import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { addedLinks } = await import("./tools");

/* Batch E (E11): a linking phrase the manager never wrote ("resulting in", "because") is a fact on propose_form and edit_form. */
describe("linking phrases a new wording adds", () => {
  it("names a cause or result the old text did not have", () => {
    expect(addedLinks("she didnt check the beds between clients and left towels on the floor in room 3", "She did not check the beds between clients, resulting in towels being left on the floor in room 3.")).toEqual(["resulting in"]);
  });
  it("names nothing when the manager wrote the link", () => {
    expect(addedLinks("late because of traffic", "She was late because of traffic.")).toEqual([]);
  });
});
