import { afterEach, describe, expect, it } from "vitest";

import { agentLoopFor, agentLoopStepLimit, agentLoopUsers } from "./switch";

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
  it("off: nobody, whatever the list says", () => {
    delete process.env.AGENT_LOOP_ENABLED;
    process.env.AGENT_LOOP_USERS = "pilot.manager@example.test";
    expect(agentLoopFor("pilot.manager@example.test")).toBe(false);
    process.env.AGENT_LOOP_ENABLED = "false";
    expect(agentLoopFor("pilot.manager@example.test")).toBe(false);
  });

  it("on with no list: every signed-in user", () => {
    process.env.AGENT_LOOP_ENABLED = "true";
    delete process.env.AGENT_LOOP_USERS;
    expect(agentLoopFor("anyone@example.test")).toBe(true);
    process.env.AGENT_LOOP_USERS = " , ";
    expect(agentLoopFor("anyone@example.test")).toBe(true);
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
