import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { readExitFacts } from "./exit-facts";

/**
 * QA's October triage (10 Nov 2026): "she submited her notice on 9/29/26" left the notice date blank, while
 * "submitted" fills it. The manager's wording is kept; the person is invented.
 */
const TODAY = "2026-10-25";
const FLAG = "EXIT_NOTICE_VERB_TYPOS_ENABLED";

const SUBMITED = "she submited her notice on 9/29/26";
const RUN_ON =
  "create an exit form for ava pellmore  she in not eligable for rehire because of her performace this month would have been a termination if she did not already ahave her notice in at the time. her last day will be 10/12/2026 and she submited her notice on 9/29/26  she put her notice in because she doesnt have time to work with her basketball schuedule  and school schedule";

const stubbed: string[] = [];
function production(on: boolean): void {
  const flags = (JSON.parse(readFileSync("src/config/production-flags.json", "utf8")) as { on: string[] }).on;
  for (const name of flags) {
    if (process.env[name] === undefined) stubbed.push(name);
    process.env[name] = "true";
  }
  process.env[FLAG] = on ? "true" : "";
}
afterEach(() => {
  for (const name of stubbed.splice(0)) delete process.env[name];
  delete process.env[FLAG];
});

/* How managers type: all lowercase, sentence case, ALL CAPS. */
const REGISTERS: [string, (text: string) => string][] = [
  ["all lowercase", (text) => text.toLowerCase()],
  ["sentence case", (text) => text.charAt(0).toUpperCase() + text.slice(1).split("ava pellmore").join("Ava Pellmore")],
  ["ALL CAPS", (text) => text.toUpperCase()],
];

describe.each(REGISTERS)("EXIT_NOTICE_VERB_TYPOS_ENABLED with production's flags: %s", (_register, as) => {
  it("off: \"submited her notice on 9/29/26\" leaves the notice date blank (the bug)", () => {
    production(false);
    expect(readExitFacts(as(SUBMITED), TODAY).noticeGiven).toBeNull();
    expect(readExitFacts(as(RUN_ON), TODAY)).toMatchObject({ noticeGiven: null, lastDayWorked: "2026-10-12" });
  });

  it("on: the notice date is 9/29/26, as for \"submitted\"; the last day stays 10/12", () => {
    production(true);
    expect(readExitFacts(as(SUBMITED), TODAY).noticeGiven).toBe("2026-09-29");
    expect(readExitFacts(as(SUBMITED), TODAY)).toEqual(readExitFacts(as("she submitted her notice on 9/29/26"), TODAY));
    expect(readExitFacts(as(RUN_ON), TODAY)).toMatchObject({ noticeGiven: "2026-09-29", lastDayWorked: "2026-10-12" });
  });

  it("on: the date first, then the misspelled verb (\"on 9/29/26 she submited her notice\")", () => {
    production(true);
    expect(readExitFacts(as("on 9/29/26 she submited her notice"), TODAY).noticeGiven).toBe("2026-09-29");
  });

  it("on: never the employer's act, and a misspelling with no notice after it names nothing", () => {
    production(true);
    expect(readExitFacts(as("on 9/29/26 we submited her notice"), TODAY).noticeGiven).toBeNull();
    expect(readExitFacts(as("she submited her timesheet on 9/29/26"), TODAY).noticeGiven).toBeNull();
  });
});
