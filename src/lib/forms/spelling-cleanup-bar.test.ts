import { describe, expect, it } from "vitest";

import { noteAccountNames, withAccountNames } from "./account-names";
import { cleanupChanges } from "./spelling-cleanup";

/*
 * QA's bar for the cleanup check (the sibling gate's #772 probe, 14 Nov 2026; ported), in the gate's wordings with this app's salons. The people are
 * invented: a coworker Manuel Quellby on the roster.
 */
const TODAY = "2026-11-14";
const changes = (source: string, written: string, names: readonly string[] = []) => cleanupChanges({ source, written, today: TODAY, names });

describe("cleanupChanges: QA's bar", () => {
  it("a plural of a name word is not a changed name (Gate-Sunny-2, #983: \"Test Employee\", \"Employees are expected\")", () => {
    // The route's source is the prompt, the notes and the form's values: the name is typed more often than it is written.
    const said = "create a written CA for Test Employee at Kearney, she was 20 minutes late for her shift on 10-20-26";
    const source = [said, "Test Employee"].join("\n");
    const written =
      "Observed:\nOn October 20, 2026, Test Employee arrived 20 minutes late for her scheduled shift.\nExpectation:\nEmployees are expected to arrive on time.";
    expect(changes(source, written, ["Test Employee"])).toEqual([]);
    // A name still changed into a near word is caught.
    expect(changes("Manuel saw her leave", "Manual saw her leave.", ["Manuel Quellby"])).toContainEqual(expect.stringMatching(/^name manuel/));
  });

  it("an edited single-quoted span is caught", () => {
    expect(changes("she told a guest 'that is not my registr'", "She told a guest 'that is not my register'.")).toContainEqual(expect.stringMatching(/^quote /));
    expect(changes("she told a guest ‘that is not my registr’", "She told a guest ‘that is not my register’.")).toContainEqual(expect.stringMatching(/^quote /));
  });

  it("a salon name is a name: a salon word mended, or a near miss turned into one, is a changed name", () => {
    expect(changes("she was late at the kearny salon", "She was late at the kearney salon.")).toContainEqual(expect.stringMatching(/^name kearny/));
    expect(changes("she was sent to Kearny", "She was sent to kearney.")).toContainEqual(expect.stringMatching(/^name kearny/));
    expect(changes("she covered a shift at Lincon", "She covered a shift at lincoln.")).toContainEqual(expect.stringMatching(/^name lincon/));
  });

  it("every roster name is a name, in any case", () => {
    withAccountNames(() => {
      noteAccountNames([{ firstName: "Manuel", lastName: "Quellby" }]);
      expect(changes("Manuel saw her leave the drawer open", "manual saw her leave the drawer open.")).toContainEqual(expect.stringMatching(/^name manuel/));
      expect(changes("manuel saw her leave the drawer open", "Manual saw her leave the drawer open.")).toContainEqual(expect.stringMatching(/^name manuel/));
    });
  });

  it("ordinary spelling cleanup still passes", () => {
    expect(changes("not doing th e10 minute sanitaion", "Not doing the 10-minute sanitation.")).toEqual([]);
    expect(changes("she was late at kearney", "She was late at Kearney.")).toEqual([]);
    expect(changes("she didn't count the registr", "She didn't count the register.")).toEqual([]);
  });
});

describe("cleanupChanges: Gate-Sunny-2's #983 probes", () => {
  it("a quote left open to the end is caught", () => {
    expect(changes("she said ‘i read the polcy", "She said ‘i read the policy.")).toContainEqual(expect.stringMatching(/^quote /));
    expect(changes(`she said "i read the polcy`, `She said "i read the policy.`)).toContainEqual(expect.stringMatching(/^quote /));
    // The same words kept, only a full stop added: not a changed quote.
    expect(changes("she said ‘i read the polcy", "She said ‘i read the polcy.")).toEqual([]);
  });

  it("a single-quoted span with an apostrophe inside is one quote", () => {
    expect(changes("she told a guest 'that isn't my registr' and walked off", "She told a guest 'that isn't my register' and walked off.")).toContainEqual(expect.stringMatching(/^quote /));
  });

  it("a lowercase near miss of a long place name turned into a spelling of it is a changed name", () => {
    expect(changes("she was sent to kerny", "She was sent to Kearny.")).toContainEqual(expect.stringMatching(/^name kerny/));
    expect(changes("she was sent to kerny", "She was sent to Kearney.")).toContainEqual(expect.stringMatching(/^name kerny/));
  });
});
