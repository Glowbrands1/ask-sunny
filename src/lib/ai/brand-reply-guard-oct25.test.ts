import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOTHING_LEFT, withoutOtherBrands } from "./brand-reply-guard";

/**
 * ============================================================================
 * A REPLY SPEAKS FOR SUN TAN CITY ONLY (BRAND_REPLY_GUARD_ENABLED)
 * ============================================================================
 *
 * Ported from the sibling app (QA, 25 Oct 2026, testers G21/U1/U6): the JBA
 * manual's company-wide text lists every brand, and the model's prose carried
 * that list into an answer. Here the other company is the sibling one; Sun
 * Tan City's own wording, JB & Associates and the shared tanning sections stay.
 * Questions in the managers' register: "what does our policy say about
 * attendance?", "late opening policy", "whats policy say about changing
 * availabilty".
 */

afterEach(() => vi.unstubAllEnvs());
// Flag-off pins hold whatever the environment has on; flag-on tests set it.
beforeEach(() => vi.stubEnv("BRAND_REPLY_GUARD_ENABLED", ""));
const on = () => vi.stubEnv("BRAND_REPLY_GUARD_ENABLED", "true");

const REPLIES = {
  attendance:
    "The attendance policy applies across all brands (Buff City Soap, Crunch, Sun Tan City, JB & Associates office) [p.14]. A no call no show for a scheduled shift may result in immediate termination [p.14].",
  availability:
    "Submit availability changes two weeks ahead in MyGlow for Sun Tan City, or MyGlow for Buff City Soap [p.37].",
  onlyOther: "Late Opening applies to the salon [p.15]. Buff City Soap stores follow the same rule.",
  slash: "If you can't open the salon/store on time, notify your manager [p.15].",
};

describe("flag off: the reply as written", () => {
  it.each(Object.entries(REPLIES))("%s", (_name, reply) => {
    expect(withoutOtherBrands(reply)).toBe(reply);
  });
});

describe("flag on: Sun Tan City only, citations kept", () => {
  it("attendance: the list loses its sibling-company item only", () => {
    on();
    const out = withoutOtherBrands(REPLIES.attendance);
    expect(out).not.toMatch(/buff city/i);
    expect(out).toContain("A no call no show for a scheduled shift may result in immediate termination [p.14].");
  });

  it("availability: Sun Tan City's own system is kept", () => {
    on();
    expect(withoutOtherBrands(REPLIES.availability)).toBe(
      "Submit availability changes two weeks ahead in MyGlow for Sun Tan City [p.37].",
    );
  });

  it("a sentence only about the sibling company is dropped", () => {
    on();
    expect(withoutOtherBrands(REPLIES.onlyOther)).toBe("Late Opening applies to the salon [p.15].");
  });

  it('"salon/store" is "salon"', () => {
    on();
    expect(withoutOtherBrands(REPLIES.slash)).toBe("If you can't open the salon on time, notify your manager [p.15].");
  });
});

describe("flag on: Sun Tan City's own wording stays", () => {
  it.each([
    "For Sun Tan City and Crunch tanning rooms specifically, service animals are allowed in the tanning room [p.50].",
    "JB & Associates office staff follow the same attendance policy [p.14].",
    "Cite the JBA Policy Manual, Late Opening, p.15.",
    "Ask your salon director to approve the change.",
  ])("%s", (reply) => {
    on();
    expect(withoutOtherBrands(reply)).toBe(reply);
  });
});

/* QA-2 review, 26 Oct 2026: never an empty reply; quoted titles kept as written. */
describe("flag on: QA-2 review", () => {
  it.each(["Buff City Soap applies this to its stores.", "Policy: Buff City Soap Policy Manual [p.14]."])(
    "never empties a reply: %s",
    (reply) => {
      on();
      expect(withoutOtherBrands(reply)).toBe(NOTHING_LEFT);
      expect(NOTHING_LEFT).toContain("Sun Tan City");
      expect(NOTHING_LEFT).not.toMatch(/buff city/i);
    },
  );

  it.each(['See "Salon/Store Opening" on the card [p.15].', "Cite the Salon Director Manual, Late Opening [p.15]."])(
    "keeps quoted text and manual titles: %s",
    (reply) => {
      on();
      expect(withoutOtherBrands(reply)).toBe(reply);
    },
  );
});

/*
 * HOW REPLIES ARE TYPED (QA-5, 26 Oct 2026): the same replies all lowercase
 * and in sentence case, brand names included. The sibling company is taken
 * out in each, and the reply keeps its policy and its citations.
 */
describe("flag on: the same result in lowercase and sentence case", () => {
  const lower = (text: string) => text.toLowerCase();
  const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  const SIBLING = /buff\s+city|\bbcs\b/i;

  it.each([
    ["attendance", REPLIES.attendance, /no call no show/i],
    ["availability", REPLIES.availability, /myglow/i],
    ["onlyOther", REPLIES.onlyOther, /late opening applies/i],
  ] as const)("%s", (_name, reply, kept) => {
    on();
    for (const typed of [lower(reply), sentence(reply)]) {
      const out = withoutOtherBrands(typed);
      expect(out).not.toMatch(SIBLING);
      expect(out).toMatch(kept);
      expect(out).toMatch(/\[p\.\d+\]/);
    }
  });
});

/*
 * QA-5, 26 Oct 2026: a title before a comma is not a list item, and ";"
 * ends a clause, so this company's half of a sentence is kept.
 */
describe("flag on: QA-5 wording defects", () => {
  const lower = (text: string) => text.toLowerCase();
  const sentence = (text: string) => text.charAt(0) + text.slice(1).toLowerCase();
  it.each([
    ["Per the JBA Policy Manual, Buff City Soap staff and salon staff both clock in on time.", /^per the jba policy manual, salon staff clock in on time\.$/i],
    ["Do not use the Buff City Soap process; use MyGLOW for Sun Tan City, or Revel for Buff City Soap.", /^use myglow for sun tan city\.$/i],
  ] as const)("%s", (reply, expected) => {
    on();
    for (const typed of [reply, lower(reply), sentence(reply)]) {
      const out = withoutOtherBrands(typed);
      expect(out).toMatch(expected);
      expect(out).not.toBe(NOTHING_LEFT);
    }
  });
});

/* QA-5, 26 Oct 2026, second probe: a true rule that ends "including <another brand>…" keeps its rule. */
describe("flag on: a trailing clause about another brand goes, the rule stays", () => {
  const registers = (text: string) => [text, text.toLowerCase(), text.toUpperCase()];
  it.each(
    [
      ["Standards of Conduct (p.12) applies to every employee, including Buff City Soap employees.", /^standards of conduct \(p\.12\) applies to every employee\.$/i],
      ["Standards of Conduct applies to every employee, including Buff City Soap employees.", /^standards of conduct applies to every employee\.$/i],
      ["Late opening is a verbal warning, including at Buff City Soap.", /^late opening is a verbal warning\.$/i],
      ["Sun Tan City uses Revel; Buff City Soap uses Square. Late opening is verbal.", /^sun tan city uses revel\. late opening is verbal\.$/i],
    ].flatMap(([text, expected]) => registers(text as string).map((typed) => [typed, expected] as const)),
  )("%s", (reply, expected) => {
    on();
    const out = withoutOtherBrands(reply);
    expect(out).toMatch(expected);
    expect(out).not.toBe(NOTHING_LEFT);
  });
});

/*
 * QA-5 and QA-7, 26 Oct 2026: a contrast clause about another brand goes and
 * the true main clause stays; a prohibition that only set up the other
 * brand's instruction goes with it; "SALON/STORE" keeps its capitals; and an
 * ordinary answer is untouched. Original, lowercase, sentence case and CAPS.
 */
describe("flag on: QA-5 and QA-7, second review", () => {
  const registers = (text: string) => [...new Set([text, text.toLowerCase(), text.charAt(0).toUpperCase() + text.slice(1).toLowerCase(), text.toUpperCase()])];

  it.each(
    [
      ["Late opening is verbal at Sun Tan City, but at Buff City Soap it is a written warning.", /^late opening is verbal at sun tan city\.$/i],
      ["Standards of Conduct applies to everyone except Buff City Soap employees.", /^standards of conduct applies to everyone\.$/i],
      ["Late opening is a verbal warning, whereas at Buff City Soap it is written.", /^late opening is a verbal warning\.$/i],
      ["Do not use Revel; use MyGLOW for Buff City Soap. Late opening is verbal.", /^late opening is verbal\.$/i],
    ].flatMap(([text, expected]) => registers(text as string).map((typed) => [typed, expected] as const)),
  )("%s", (reply, expected) => {
    on();
    const out = withoutOtherBrands(reply);
    expect(out).toMatch(expected);
    expect(out).not.toBe(NOTHING_LEFT);
  });

  it("a prohibition that only set up the other brand's instruction is not left as this company's rule", () => {
    on();
    for (const reply of registers("Do not use Revel; use MyGLOW for Buff City Soap.")) {
      expect(withoutOtherBrands(reply)).toBe(NOTHING_LEFT);
    }
  });

  it("a prohibition before a kept clause stays", () => {
    on();
    expect(withoutOtherBrands("Do not open late; call your manager first.")).toBe("Do not open late; call your manager first.");
  });

  it.each([
    ["IF YOU CAN'T OPEN THE SALON/STORE ON TIME, CALL YOUR MANAGER.", "IF YOU CAN'T OPEN THE SALON ON TIME, CALL YOUR MANAGER."],
    ["If you can't open the salon/store on time, call your manager.", "If you can't open the salon on time, call your manager."],
    ["Salon/Store opening steps are on p.18.", "Salon opening steps are on p.18."],
  ])("the location word keeps the case it was written in: %s", (reply, expected) => {
    on();
    expect(withoutOtherBrands(reply)).toBe(expected);
  });

  it.each(
    registers(
      "Per the JBA Policy Manual [p.12], every Sun Tan City salon opens on time. Sanitize each bed after every tan, and log it in Woven.",
    ),
  )("an ordinary answer is untouched: %s", (reply) => {
    on();
    expect(withoutOtherBrands(reply)).toBe(reply);
  });

  it("flag off: the contrast reply as written", () => {
    const reply = "Late opening is verbal at Sun Tan City, but at Buff City Soap it is a written warning.";
    expect(withoutOtherBrands(reply)).toBe(reply);
  });
});

describe("flag on: a short reply that names no other brand is kept", () => {
  it.each(["An answer.", "Yes.", "See p.12."])("%s", (reply) => {
    on();
    expect(withoutOtherBrands(reply)).toBe(reply);
  });
});
