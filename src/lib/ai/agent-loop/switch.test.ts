import { afterEach, describe, expect, it } from "vitest";

import { agentLoopFor, agentLoopSkipReason, agentLoopStepLimit, agentLoopUsers } from "./switch";

/*
 * AGENT_LOOP_ENABLED / AGENT_LOOP_USERS (QA, 14 Nov 2026): who gets the tool loop. Invented addresses only; QA sets the
 * real list in Vercel.
 */
const NAMES = ["AGENT_LOOP_ENABLED", "AGENT_LOOP_USERS", "AGENT_LOOP_MAX_STEPS"] as const;
const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe("agentLoopFor", () => {
  it("\"*\" is every signed-in user; mixed with emails it is nobody (QA, 14 Nov 2026)", () => {
    process.env.AGENT_LOOP_ENABLED = "1";
    process.env.AGENT_LOOP_USERS = " * ";
    expect(agentLoopFor("anyone@example.test")).toBe(true);
    expect(agentLoopFor("")).toBe(false);
    expect(agentLoopFor(null)).toBe(false);
    for (const mixed of ["*,pilot.manager@example.test", "pilot.manager@example.test, *"]) {
      process.env.AGENT_LOOP_USERS = mixed;
      expect(agentLoopFor("pilot.manager@example.test"), mixed).toBe(false);
      expect(agentLoopFor("anyone@example.test"), mixed).toBe(false);
    }
    process.env.AGENT_LOOP_ENABLED = "false";
    process.env.AGENT_LOOP_USERS = "*";
    expect(agentLoopFor("anyone@example.test")).toBe(false);
  });

  it("off: nobody, whatever the list says", () => {
    delete process.env.AGENT_LOOP_ENABLED;
    process.env.AGENT_LOOP_USERS = "pilot.manager@example.test";
    expect(agentLoopFor("pilot.manager@example.test")).toBe(false);
    process.env.AGENT_LOOP_ENABLED = "false";
    expect(agentLoopFor("pilot.manager@example.test")).toBe(false);
  });

  it("on with the list unset or empty: NOBODY gets the loop (Pau via QA, 14 Nov 2026)", () => {
    process.env.AGENT_LOOP_ENABLED = "1";
    delete process.env.AGENT_LOOP_USERS;
    expect(agentLoopFor("anyone@example.test")).toBe(false);
    expect(agentLoopFor("pilot.manager@example.test")).toBe(false);
    for (const empty of ["", " ", " , ", ",,"]) {
      process.env.AGENT_LOOP_USERS = empty;
      expect(agentLoopFor("anyone@example.test"), JSON.stringify(empty)).toBe(false);
    }
    process.env.AGENT_LOOP_ENABLED = "true";
    delete process.env.AGENT_LOOP_USERS;
    expect(agentLoopFor("anyone@example.test")).toBe(false);
  });

  it("on with a list: only those users, ignoring case and spaces", () => {
    process.env.AGENT_LOOP_ENABLED = "true";
    process.env.AGENT_LOOP_USERS = " Pilot.Manager@Example.test ,second.pilot@example.test";
    expect(agentLoopUsers()).toEqual(["pilot.manager@example.test", "second.pilot@example.test"]);
    expect(agentLoopFor("pilot.manager@example.test")).toBe(true);
    expect(agentLoopFor("PILOT.MANAGER@EXAMPLE.TEST ")).toBe(true);
    expect(agentLoopFor("second.pilot@example.test")).toBe(true);
    expect(agentLoopFor("someone.else@example.test")).toBe(false);
    expect(agentLoopFor("")).toBe(false);
    expect(agentLoopFor(null)).toBe(false);
    // A listed address inside another is not that address.
    expect(agentLoopFor("x.pilot.manager@example.test")).toBe(false);
  });
});

describe("agentLoopStepLimit", () => {
  it("defaults to 6 and is capped at 10", () => {
    delete process.env.AGENT_LOOP_MAX_STEPS;
    expect(agentLoopStepLimit()).toBe(6);
    process.env.AGENT_LOOP_MAX_STEPS = "8";
    expect(agentLoopStepLimit()).toBe(8);
    process.env.AGENT_LOOP_MAX_STEPS = "50";
    expect(agentLoopStepLimit()).toBe(10);
    process.env.AGENT_LOOP_MAX_STEPS = "0";
    expect(agentLoopStepLimit()).toBe(1);
    process.env.AGENT_LOOP_MAX_STEPS = "lots";
    expect(agentLoopStepLimit()).toBe(6);
  });
});

describe("agentLoopSkipReason: answer modes (ANSWER_MODE_ON_LOOP; the owner, 26 Nov 2026)", () => {
  const before = process.env.ANSWER_MODE_ON_LOOP_ENABLED;
  afterEach(() => {
    if (before === undefined) delete process.env.ANSWER_MODE_ON_LOOP_ENABLED;
    else process.env.ANSWER_MODE_ON_LOOP_ENABLED = before;
  });

  it("off: Quick and Detailed go to today's path, as before; Standard goes to the loop", () => {
    process.env.ANSWER_MODE_ON_LOOP_ENABLED = "0";
    expect(agentLoopSkipReason({ mode: "quick" })).toBe("answer_mode");
    expect(agentLoopSkipReason({ mode: "detailed" })).toBe("answer_mode");
    expect(agentLoopSkipReason({ mode: "standard" })).toBeNull();
  });

  it("on: every mode goes to the loop; report context still goes to today's path", () => {
    process.env.ANSWER_MODE_ON_LOOP_ENABLED = "1";
    for (const mode of ["quick", "standard", "detailed"]) expect(agentLoopSkipReason({ mode }), mode).toBeNull();
    /* Changed on purpose (Pau, 26 Nov 2026): attachments are no longer a skip reason; the loop reads the files (`attachments.server.ts`). */
    expect(agentLoopSkipReason({ mode: "quick", attachments: [{ filename: "plan.pdf", mediaType: "application/pdf", url: "data:application/pdf;base64,AA==" }] } as never)).toBeNull();
    expect(agentLoopSkipReason({ mode: "detailed", reportContext: { family: "sales-totals" } })).toBe("report_context");
  });
});

describe("answerModeLine (ANSWER_MODE_ON_LOOP)", () => {
  it("Quick and Detailed each add one line; Standard adds nothing", async () => {
    const { answerModeLine } = await import("./prompt");
    expect(answerModeLine("standard")).toBe("");
    expect(answerModeLine("quick")).toMatch(/^Answer length: the manager chose Quick\./);
    expect(answerModeLine("quick")).toMatch(/A form card, the question a card needs, a policy citation and every line the rules book asks for are still given in full/);
    expect(answerModeLine("detailed")).toMatch(/^Answer length: the manager chose Detailed\./);
  });
});
