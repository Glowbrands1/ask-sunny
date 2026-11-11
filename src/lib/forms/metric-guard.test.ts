import { afterEach, describe, expect, it, vi } from "vitest";

import type { AskResponse } from "@/lib/ai/types";

import { withoutMetricChoices, withRosterOnlyNames } from "./roster-only-names";
import { installRequestMessage, namesAMetric } from "./request-slot";

/**
 * METRIC_GUARD_ENABLED (ported from the sibling app: QA's LIVE=1 there, 5 Nov 2026, the smaller set, 3/3 runs).
 * The message is this app's own metric wording (PPTA, LPSVA, Club Average, Club Close %, Spa %, Under Performance, MSB:
 * QA's 14-day count of real manager messages); the person is invented (checked against both directories).
 */
const MESSAGE = "I need a corrective action verbal for Perpetua T. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.";
const LIVE = "Which of them is this **Corrective Action Form** for — **Club Close**, **Perpetua** or **Under**?";
const ROSTER = ["Perpetua Thornquist", "Marnie Holloway"];
const reply = (content: string): AskResponse => ({ content, citations: [], recommendedVideoIds: [] });

afterEach(() => {
  vi.unstubAllEnvs();
  installRequestMessage(() => undefined);
});

describe("METRIC_GUARD_ENABLED off: as before (the bug)", () => {
  it("the live reply keeps **Club Close** and **Under** as people", () => {
    installRequestMessage(() => MESSAGE);
    expect(withRosterOnlyNames(reply(LIVE)).content).toBe(LIVE);
  });
});

describe("METRIC_GUARD_ENABLED on, FORM_NAME off: no metric is ever a choice", () => {
  it("QA's live reply: the metrics go, the one person left is asked by her roster name", () => {
    vi.stubEnv("METRIC_GUARD_ENABLED", "true");
    const out = withoutMetricChoices(reply(LIVE), MESSAGE, ROSTER).content;
    expect(out).toBe("Is this for **Perpetua Thornquist**?");
    expect(out).not.toMatch(/Club Close|Under/);
  });

  it("through the step the chat runs (`withRosterOnlyNames`), with FORM_NAME off", () => {
    vi.stubEnv("METRIC_GUARD_ENABLED", "true");
    // Changed on purpose (the roster-set gate R16A, 10 Nov 2026): the flag is pinned off here, so the set's env (FORM_NAME and companions on) does not leak in.
    vi.stubEnv("FORM_NAME_FROM_ROSTER_ENABLED", "");
    installRequestMessage(() => MESSAGE);
    expect(withRosterOnlyNames(reply(LIVE)).content).not.toMatch(/\*\*(?:Club Close|Under)\*\*/);
  });

  it("\"Is this for **Club Average**?\" asks who instead", () => {
    expect(withoutMetricChoices(reply("Is this for **Club Average**?"), MESSAGE, ROSTER).content).toMatch(/^Who is this form for\?/);
  });

  it("MSB in the list (this app's most common metric request) is never a choice either", () => {
    vi.stubEnv("CHAT_GLOSSARY_ENABLED", "true"); // on in the smaller set: MSB is an approved glossary term
    const message = "I need a verbal CA for Perpetua T. Under Performance on PPTA, LPSVA, Club Close %, and MSB for october.";
    const text = "Which of them is this **Corrective Action Form** for — **MSB**, **Perpetua** or **Club Close**?";
    expect(withoutMetricChoices(reply(text), message, ROSTER).content).toBe("Is this for **Perpetua Thornquist**?");
  });

  it("a phrase written with a percent sign is a metric in a list of two (\"on Club Close % and Spa %\")", () => {
    const message = "I need a corrective action for Coaching Form. This is for Under Performance on Club Close % and Spa %.";
    expect(namesAMetric("Club Close", message)).toBe(true);
    expect(namesAMetric("Spa", message)).toBe(true);
    expect(namesAMetric("Under", message)).toBe(true);
    expect(withoutMetricChoices(reply("Which of them is this **Coaching Form** for — **Club Close** or **Under**?"), message, ROSTER).content).toMatch(/^Who is this form for\?/);
  });

  it("negative: two people and no metric are left as they are", () => {
    const text = "Which of them is this **Corrective Action Form** for — **Marnie Holloway** or **Perpetua Thornquist**?";
    expect(withoutMetricChoices(reply(text), "create a ca for Marnie or Perpetua. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.", ROSTER).content).toBe(text);
  });

  it("negative: a roster person is kept even when the message lists them (\"CA for Marnie Holloway, Remy Calder, and Ignatius Wexlerby\")", () => {
    const text = "Which of them is this **Corrective Action Form** for — **Marnie Holloway** or **Remy Calder**?";
    expect(withoutMetricChoices(reply(text), "CA for Marnie Holloway, Remy Calder, and Ignatius Wexlerby", ["Marnie Holloway", "Remy Calder", "Ignatius Wexlerby"]).content).toBe(text);
  });

  it("negative (QA): a real off-roster name that is not a metric item stays a choice; only the metric goes", () => {
    const message = "I need a corrective action verbal for Zebulon Marchbanks or Perpetua. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.";
    const text = "Which of them is this **Corrective Action Form** for — **Zebulon Marchbanks**, **Club Close** or **Perpetua**?";
    expect(withoutMetricChoices(reply(text), message, ROSTER).content).toBe("Which of them is this **Corrective Action Form** for — **Zebulon Marchbanks** or **Perpetua**?");
    expect(withoutMetricChoices(reply("Is this for **Zebulon Marchbanks**?"), message, ROSTER).content).toBe("Is this for **Zebulon Marchbanks**?");
  });

  it("negative: a message with no list and no offense phrase changes nothing", () => {
    const text = "Which of them is this **Coaching Form** for — **Marnie Holloway** or **Club Close**?";
    expect(withoutMetricChoices(reply(text), "create a coaching form", ROSTER).content).toBe(text);
  });
});

/**
 * METRIC_CHOICE_ONE_QUESTION_ENABLED (QA, 7 Nov 2026; default off). The same tail as the FORM_NAME re-flip gate's
 * regression: a choice question with its own "Tell me and I'll …" after it (the exit intake's), every choice a metric.
 * withoutMetricChoices replaced the question with ASK_WHO and left the tail: "… full name. Tell me and I'll fill in …".
 */
describe("METRIC_CHOICE_ONE_QUESTION_ENABLED: the choice question's own tail goes with it", () => {
  const TAIL = " Tell me and I'll fill in what you've already described.";
  const ALL_METRICS = `Which of them is this **Resignation/Exit Form** for — **Club Close** or **Under**?${TAIL}`;
  const ONE_PERSON = `Which of them is this **Resignation/Exit Form** for — **Club Close**, **Perpetua** or **Under**?${TAIL}`;

  it("off: as before, the tail stays after the who-question", () => {
    vi.stubEnv("METRIC_GUARD_ENABLED", "true");
    expect(withoutMetricChoices(reply(ALL_METRICS), MESSAGE, ROSTER).content).toBe(`Who is this form for? Tell me the employee's full name.${TAIL}`);
  });

  it("on: every choice a metric asks who once", () => {
    vi.stubEnv("METRIC_GUARD_ENABLED", "true");
    vi.stubEnv("METRIC_CHOICE_ONE_QUESTION_ENABLED", "true");
    expect(withoutMetricChoices(reply(ALL_METRICS), MESSAGE, ROSTER).content).toBe("Who is this form for? Tell me the employee's full name.");
  });

  it("on: a choice still asked keeps its tail", () => {
    vi.stubEnv("METRIC_GUARD_ENABLED", "true");
    vi.stubEnv("METRIC_CHOICE_ONE_QUESTION_ENABLED", "true");
    expect(withoutMetricChoices(reply(ONE_PERSON), MESSAGE, ROSTER).content).toBe(`Is this for **Perpetua Thornquist**?${TAIL}`);
  });
});

