import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { envFlag } from "./chat-quality-flags";
import { DEFAULT_ON, flagFromEnv } from "./default-on";

/** "(E) batch 1" (Pau, 3 Nov 2026): the flags on by default, and the environment still turns them off. */
describe("flags on by default", () => {
  it("every one is on in production (src/config/production-flags.json, \"on\")", () => {
    const production = JSON.parse(readFileSync("src/config/production-flags.json", "utf8")) as { on: string[] };
    for (const name of DEFAULT_ON) expect(production.on, `${name} is not on in production`).toContain(name);
  });

  it("QA's validated batch 1, and nothing else", () => {
    expect([...DEFAULT_ON].sort()).toEqual([
      "ANGLE_PLACEHOLDER_GUARD_ENABLED",
      "CA_SHORTCUT_WORDS_ENABLED",
      "EXIT_SHORTCUT_WORDS_ENABLED",
      "FORM_EDIT_HONEST_REPLY_ENABLED",
      "FORM_EDIT_PLAIN_WORDS_ENABLED",
      "LEVEL_REQUEST_DATE_ENABLED",
      "STREET_ADDRESS_NOT_A_NAME_ENABLED",
    ]);
  });

  for (const name of DEFAULT_ON) {
    it(`${name}: on when unset or blank; "0", "false", "off", "no" turn it off`, () => {
      expect(flagFromEnv(name, undefined)).toBe(true);
      expect(flagFromEnv(name, "")).toBe(true);
      expect(flagFromEnv(name, "1")).toBe(true);
      for (const off of ["0", "false", "off", "no", " OFF "]) expect(flagFromEnv(name, off)).toBe(false);
    });
  }

  it("every other flag is still off unless its variable says on", () => {
    expect(flagFromEnv("WHOLE_TEAM_COACHING_ENABLED", undefined)).toBe(false);
    expect(flagFromEnv("WHOLE_TEAM_COACHING_ENABLED", "")).toBe(false);
    expect(flagFromEnv("WHOLE_TEAM_COACHING_ENABLED", "true")).toBe(true);
  });

  it("envFlag reads the same rule", () => {
    const saved = process.env.LEVEL_REQUEST_DATE_ENABLED;
    try {
      delete process.env.LEVEL_REQUEST_DATE_ENABLED;
      expect(envFlag("LEVEL_REQUEST_DATE_ENABLED")).toBe(true);
      process.env.LEVEL_REQUEST_DATE_ENABLED = "off";
      expect(envFlag("LEVEL_REQUEST_DATE_ENABLED")).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.LEVEL_REQUEST_DATE_ENABLED;
      else process.env.LEVEL_REQUEST_DATE_ENABLED = saved;
    }
  });
});
