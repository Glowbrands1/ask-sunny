import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { replyNameFor } = await import("./tools");

/*
 * reply_name (QA and Pau, 16 Nov 2026): what the reply calls the card's person, decided by the roster and the conversation,
 * not by the model's reading of a rule. Invented people: Rowan Kestrel, Rowan Pike, Remy Calder.
 */
const row = (id: string, firstName: string, lastName: string) => ({ id, firstName, lastName, preferredFirstName: null, salonIds: [] });
const KESTREL = row("e-4", "Rowan", "Kestrel");
const PIKE = row("e-8", "Rowan", "Pike");
const CALDER = row("e-2", "Remy", "Calder");

describe("replyNameFor", () => {
  it("a first name nobody else has gives the first name", () => {
    expect(replyNameFor("Rowan Kestrel", [KESTREL, CALDER], [], "e-4")).toBe("Rowan");
  });
  it("two roster people sharing it give the full name, even if the other is never mentioned", () => {
    expect(replyNameFor("Rowan Kestrel", [KESTREL, PIKE, CALDER], [], "e-4")).toBe("Rowan Kestrel");
  });
  it("an off-roster name colliding with a roster first name gives the full name", () => {
    expect(replyNameFor("Rowan Vale", [PIKE, CALDER], [])).toBe("Rowan Vale");
    expect(replyNameFor("Odalys Fenwick", [PIKE, CALDER], [])).toBe("Odalys");
  });
  it("another full name the manager typed in this conversation that shares the first name gives the full name", () => {
    expect(replyNameFor("Rowan Kestrel", [KESTREL, CALDER], ["Rowan Vale"], "e-4")).toBe("Rowan Kestrel");
    expect(replyNameFor("Rowan Kestrel", [KESTREL, CALDER], ["Rowan Kestrel", "Remy Calder"], "e-4")).toBe("Rowan");
  });
  it("a one-word name stays as typed", () => {
    expect(replyNameFor("Wrenna", [CALDER], [])).toBe("Wrenna");
  });
});
