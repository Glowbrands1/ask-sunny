import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { managerAccount } = await import("./remap-incident");
const { managerWordsObservation } = await import("@/lib/forms/draft-never-blank");

/*
 * LEVEL_REQUEST_DATE_ENABLED (QA, this app's live chat, 30 Oct 2026): "create
 * a written on 10/20 for <name> at kearney, she was late again" put the whole
 * request on the card as the Observation of Offense ("create a writ…"). The
 * request reader knew "create a written for …" but not a date between the
 * level and "for". The manager's words, the person invented.
 */
const SAID = "create a written on 10/20 for katrin dovetail at kearney, she was late again";
const NAME = "Katrin Dovetail";
const FLAG = "LEVEL_REQUEST_DATE_ENABLED";

function flag(on: boolean) {
  vi.stubEnv(FLAG, on ? "true" : "");
  vi.stubEnv("REQUEST_LINE_ACCOUNT_ENABLED", "true");
}
afterEach(() => vi.unstubAllEnvs());

describe("a dated level request is the request, not the account (LEVEL_REQUEST_DATE_ENABLED)", () => {
  it("QA's words: the card's Observation is what happened", () => {
    flag(true);
    expect(managerAccount(SAID, NAME)).toBe("she was late again");
  });

  it("off, as live: the request is kept as the account", () => {
    flag(false);
    expect(managerAccount(SAID, NAME)).toMatch(/^create a written on 10\/20/);
  });

  it("the draft written from the manager's words starts with what happened", () => {
    flag(true);
    expect(managerWordsObservation(SAID, NAME)).toMatch(/\nShe was late again\.$/);
  });

  it("off: the draft from the manager's words starts with the request", () => {
    flag(false);
    expect(managerWordsObservation(SAID, NAME)).toMatch(/\nCreate a written on 10\/20/);
  });

  for (const said of [
    "create a written on 10-20-26 for katrin dovetail, she was late again",
    "make a verbal 10/20 for katrin dovetail, she was late again",
    "create a final warning on 10/20 for katrin dovetail, she was late again",
  ]) {
    it(`"${said}" → she was late again`, () => {
      flag(true);
      expect(managerAccount(said, NAME)).toBe("she was late again");
    });
  }

  it("undated, as before", () => {
    flag(true);
    const said = "create a written for katrin dovetail at kearney, she was late again";
    const on = managerAccount(said, NAME);
    flag(false);
    expect(on).toBe(managerAccount(said, NAME));
  });

  it("an account that only mentions a written is kept", () => {
    flag(true);
    expect(managerAccount("she tore up the written on 10/20 for no reason", NAME)).toBe("she tore up the written on 10/20 for no reason");
  });
});
