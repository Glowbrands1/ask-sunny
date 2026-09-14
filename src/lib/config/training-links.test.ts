import { describe, expect, it } from "vitest";

import {
  TEAMS_TRAINING_URL_ENV,
  WOVEN_TRAINING_URL_ENV,
  hasConfiguredTraining,
  trainingLinks,
} from "./training-links";

/**
 * ============================================================================
 * THE TRAINING CTA WHEN NOBODY HAS CONFIGURED IT YET
 * ============================================================================
 *
 * THE REVIEW: "Recommended Training is currently an empty section. Since our
 * training videos live in Teams and Woven, I'd rather this be a link directing
 * users to those resources than an empty section."
 *
 * The URLs are facts about the customer's tenancy that this repository does not
 * know, so the unconfigured state is the state this ships in and will stay in
 * until Paulyne supplies them. It is therefore the state most worth testing —
 * the configured one will be seen by somebody the day it is set up, and the
 * empty one is the one that has to be right unattended.
 *
 * THE TWO FAILURES THIS RULES OUT are both worse than an empty section, which
 * is what makes them worth a test rather than a comment:
 *
 *   A DEAD LINK. A rendered anchor to nowhere, discovered by a Salon Director
 *   rather than by a developer.
 *
 *   A RELATIVE URL. `/training` from configuration resolves against Ask Sunny's
 *   own origin and produces a link to a page that does not exist here — the
 *   exact failure this module exists to avoid, arriving through configuration
 *   instead of through code.
 */

describe("training links with nothing configured", () => {
  it("returns both destinations with no href, rather than an empty list", () => {
    /*
     * BOTH ARE ALWAYS RETURNED. An empty list gives the caller nothing to say;
     * two entries with null hrefs let it name what is missing and which
     * variable sets it, which is an empty state an administrator can act on.
     */
    const links = trainingLinks({});

    expect(links).toHaveLength(2);
    expect(links.map((link) => link.key)).toEqual(["teams", "woven"]);
    for (const link of links) {
      expect(link.href).toBeNull();
      expect(link.label).toBeTruthy();
      expect(link.description).toBeTruthy();
    }
  });

  it("names the variable an administrator has to set", () => {
    // A gap that names its own fix is actionable; "not configured" is not.
    const links = trainingLinks({});

    expect(links[0].envVar).toBe(TEAMS_TRAINING_URL_ENV);
    expect(links[1].envVar).toBe(WOVEN_TRAINING_URL_ENV);
  });

  it("reports that nothing is configured", () => {
    expect(hasConfiguredTraining(trainingLinks({}))).toBe(false);
  });
});

describe("training links with something configured", () => {
  it("uses an absolute https URL", () => {
    const links = trainingLinks({
      [TEAMS_TRAINING_URL_ENV]: "https://teams.microsoft.com/l/channel/training",
    });

    expect(links[0].href).toBe("https://teams.microsoft.com/l/channel/training");
    expect(links[1].href).toBeNull();
    expect(hasConfiguredTraining(links)).toBe(true);
  });

  it("accepts one destination without requiring the other", () => {
    // Teams may be ready before Woven. Half-configured must not read as
    // unconfigured, or the half that works would never be shown.
    const links = trainingLinks({ [WOVEN_TRAINING_URL_ENV]: "https://woven.example.com/paths" });

    expect(links[0].href).toBeNull();
    expect(links[1].href).toBe("https://woven.example.com/paths");
    expect(hasConfiguredTraining(links)).toBe(true);
  });

  it("trims surrounding whitespace, which a pasted value carries", () => {
    const links = trainingLinks({ [TEAMS_TRAINING_URL_ENV]: "  https://teams.example.com/x  " });

    expect(links[0].href).toBe("https://teams.example.com/x");
  });
});

describe("a configured value that would produce a broken link", () => {
  it("refuses a relative path rather than linking to a page that is not here", () => {
    for (const value of ["/training", "training", "./training", "../training"]) {
      expect(trainingLinks({ [TEAMS_TRAINING_URL_ENV]: value })[0].href, value).toBeNull();
    }
  });

  it("refuses a scheme that is not http or https", () => {
    /*
     * `javascript:` is the one that matters — this href is rendered into an
     * anchor, and a caller that trusted the value would have an injection.
     * `mailto:` and `file:` are refused for the plainer reason that neither is
     * a training destination a browser can open usefully from here.
     */
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:training@example.com",
      "file:///training",
    ]) {
      expect(trainingLinks({ [TEAMS_TRAINING_URL_ENV]: value })[0].href, value).toBeNull();
    }
  });

  it("refuses an empty or whitespace-only value", () => {
    // An unset variable and one set to "" must behave identically; a deployment
    // that clears a value should return to the honest empty state.
    for (const value of ["", "   ", "\t\n"]) {
      expect(trainingLinks({ [TEAMS_TRAINING_URL_ENV]: value })[0].href).toBeNull();
    }
    expect(hasConfiguredTraining(trainingLinks({ [TEAMS_TRAINING_URL_ENV]: "" }))).toBe(false);
  });

  it("refuses a value that is not a URL at all", () => {
    for (const value of ["ask sunny training", "https://", "::::"]) {
      expect(trainingLinks({ [TEAMS_TRAINING_URL_ENV]: value })[0].href, value).toBeNull();
    }
  });
});
