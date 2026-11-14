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
