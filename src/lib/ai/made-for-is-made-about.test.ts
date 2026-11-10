import { afterEach, describe, expect, it } from "vitest";

import { asMadeAboutWording, madeAbout } from "./make-it-about";

const SAID = "can you make it for missing out monthly meeting";

describe("MADE_FOR_IS_MADE_ABOUT (QA's live Sunny r20, 10 Nov 2026)", () => {
  afterEach(() => {
    delete process.env.MADE_FOR_IS_MADE_ABOUT_ENABLED;
  });
  it("off, as before: \"make it for <topic>\" is not a made-about", () => {
    expect(madeAbout(SAID)).toBeNull();
    expect(asMadeAboutWording(SAID)).toBe(SAID);
  });
  describe("on", () => {
    const on = () => {
      process.env.MADE_FOR_IS_MADE_ABOUT_ENABLED = "true";
    };
    it("QA's exact sentence is a made-about, about what happened", () => {
      on();
      expect(madeAbout(SAID)).toBe("missing out monthly meeting");
      expect(asMadeAboutWording(SAID)).toBe("can you make it about missing out monthly meeting");
    });
    it("\"not clocking in\" and \"being late\" are accounts too", () => {
      on();
      expect(madeAbout("make this for not clocking in on time")).toBe("not clocking in on time");
      expect(madeAbout("please make the form for being late twice this week")).toBe("being late twice this week");
    });
    it("a date, a person, a salon, a level or a time of day is not", () => {
      on();
      for (const text of ["make it for 10/14/26", "make it for Perrin", "make it for Kearney", "make it for a verbal", "make it for morning shift"]) {
        expect(madeAbout(text), text).toBeNull();
        expect(asMadeAboutWording(text), text).toBe(text);
      }
    });
    it("\"make it about …\" is unchanged", () => {
      on();
      expect(asMadeAboutWording("make it about showing up late")).toBe("make it about showing up late");
      expect(madeAbout("make it about showing up late")).toBe("showing up late");
    });
  });
});
