import { afterEach, describe, expect, it } from "vitest";

import { expandTerseRequest } from "./terse-slots";

/**
 * QA, 26 Oct 2026 (sibling tester, terse commands): What happened began with
 * the employee's name — "On 10/11/26 devon harlan dress code", "On 9-20-26
 * devon harlan opened late 15 min". TERSE_INCIDENT_NO_NAME_ENABLED keeps the
 * name in the request sentence only. Invented names.
 */
const TODAY = "2026-10-25";
const FLAG = "TERSE_INCIDENT_NO_NAME_ENABLED";

afterEach(() => {
  delete process.env[FLAG];
});

const DRESS = "ca quenby arlott kearney dress code 10/11 verbal";
const LATE = "ca quenby arlott opened late 15 min 9-20 verbal 25 deduct";
const NO_DATE = "ca for quenby arlott not opening on time and no call no show";

/* How managers type (Pau, 26 Oct 2026): all lowercase, and sentence case with the name capitalised. */
const REGISTERS: [string, (text: string) => string][] = [
  ["all lowercase", (text) => text.toLowerCase()],
  [
    "sentence case",
    (text) => {
      const named = text.split("quenby arlott").join("Quenby Arlott");
      return named.charAt(0).toUpperCase() + named.slice(1);
    },
  ],
];

/** The sentence after the request: what the form will say happened. */
function incident(expanded: string): string {
  return expanded.slice(expanded.indexOf(". ") + 2);
}

describe.each(REGISTERS)(
  "TERSE_INCIDENT_NO_NAME_ENABLED (%s)",
  (_register, as) => {
    it("off: the incident sentence starts with the name, as before", () => {
      expect(
        incident(expandTerseRequest(as(DRESS), TODAY)).toLowerCase(),
      ).toMatch(/^on 10\/11\/26 quenby arlott dress code\./);
    });

    it("on: What happened is the account alone", () => {
      process.env[FLAG] = "true";
      expect(incident(expandTerseRequest(as(DRESS), TODAY))).toMatch(
        /^On 10\/11\/26, dress code\. This is a verbal warning\.$/i,
      );
      expect(incident(expandTerseRequest(as(LATE), TODAY))).toMatch(
        /^On 9-20-26, opened late 15 min\. This is a verbal warning\./i,
      );
      expect(incident(expandTerseRequest(as(NO_DATE), TODAY))).toMatch(
        /^Not opening on time and no call no show\.$/i,
      );
      for (const text of [DRESS, LATE, NO_DATE]) {
        expect(
          incident(expandTerseRequest(as(text), TODAY)).toLowerCase(),
        ).not.toContain("quenby");
      }
    });

    for (const on of [false, true]) {
      it(`NEVER-BREAK (flag ${on ? "on" : "off"}): the request still names the employee, the date and the level`, () => {
        if (on) process.env[FLAG] = "true";
        const expanded = expandTerseRequest(as(LATE), TODAY).toLowerCase();
        expect(expanded).toMatch(
          /^create a corrective action form for quenby arlott\./,
        );
        expect(expanded).toContain("9-20-26");
        expect(expanded).toContain("this is a verbal warning.");
        expect(expanded).toContain(
          "payroll deduct applies and $25 will be deducted.",
        );
        // An exit's facts stay as typed.
        expect(
          expandTerseRequest(
            as(
              "exit form quenby arlott last day 10/9/26 resigned eligible for rehire",
            ),
            TODAY,
          ).toLowerCase(),
        ).toContain("last day 10/9/26 resigned eligible for rehire.");
      });
    }
  },
);
