import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { caNameFromChat } from "./ca-name-from-chat";
import { installPersonRoster } from "./person-guard";

/** CA_NAME_FROM_CHAT_ENABLED — Pau, 3 Nov 2026. Invented people. */
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.CA_NAME_FROM_CHAT_ENABLED;
  process.env.CA_NAME_FROM_CHAT_ENABLED = "true";
  installPersonRoster(() => ["Remy Calder", "Remy Calderon", "Juno Paxton", "Dana Calderon", "Dana Calderon"]);
});
afterEach(() => {
  if (saved === undefined) delete process.env.CA_NAME_FROM_CHAT_ENABLED;
  else process.env.CA_NAME_FROM_CHAT_ENABLED = saved;
  installPersonRoster(() => undefined);
});

describe("the name a Corrective Action takes from the chat", () => {
  it("the same first name, one person on the roster: the roster's spelling", () => {
    expect(caNameFromChat("change her name to remy calderon", "Remy Calder")).toBe("Remy Calderon");
  });

  it("the same last name: allowed", () => {
    expect(caNameFromChat("change her name to Juno Paxton", "June Paxton")).toBe("Juno Paxton");
  });

  it("a different person's name is never written", () => {
    expect(caNameFromChat("change her name to Juno Paxton", "Remy Calder")).toBeNull();
  });

  it("not on the roster, or two people with it: nothing", () => {
    expect(caNameFromChat("change her name to Remy Okonkwo", "Remy Calder")).toBeNull();
    expect(caNameFromChat("change her name to Dana Calderon", "Dana Calder")).toBeNull();
  });

  it("no roster: nothing", () => {
    installPersonRoster(() => undefined);
    expect(caNameFromChat("change her name to Remy Calderon", "Remy Calder")).toBeNull();
  });

  it("the same name, or not a rename: nothing", () => {
    expect(caNameFromChat("change her name to Remy Calder", "Remy Calder")).toBeNull();
    expect(caNameFromChat("she was late again", "Remy Calder")).toBeNull();
  });

  it("off: nothing", () => {
    process.env.CA_NAME_FROM_CHAT_ENABLED = "false";
    expect(caNameFromChat("change her name to Remy Calderon", "Remy Calder")).toBeNull();
  });
});
