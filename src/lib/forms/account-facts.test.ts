import { describe, expect, it } from "vitest";

import { factOfClause, type FactContext } from "./account-facts";

/* v2-Gate-Sunny-3's probes (14 Nov 2026), in its wording; places and titles here are the test's own. */
const CONTEXT: FactContext = {
  onlyPlace: (text) => /^(?:the\s+)?(?:north\s+platte|elm\s+street)(?:\s+salon)?$/i.test(text.trim()),
  onlyTitle: (text) => /^(?:tanning\s+consultant|assistant\s+salon\s+director|salon\s+director)$/i.test(text.trim()),
};
const fact = (clause: string) => factOfClause(clause, CONTEXT);

describe("factOfClause", () => {
  it.each([
    ["she yelled at a guest i guess", "she yelled at a guest"],
    ["she yelled at a guest, maybe twice", "she yelled at a guest"],
    ["she yelled at a guest as a TC", "she yelled at a guest"],
    ["she yelled at a guest as a tanning consultant", "she yelled at a guest"],
    ["she yelled at a guest at north platte", "she yelled at a guest"],
    ["she yelled at a guest, written", "she yelled at a guest"],
    ["also she didn't clean", "she didn't clean"],
    ["make it a written warning, she yelled at a guest", "she yelled at a guest"],
    ["this is a final warning she yelled at a guest", "she yelled at a guest"],
    ["she yelled at a guest as a joke", "she yelled at a guest as a joke"],
    ["she was on her phone at the desk", "she was on her phone at the desk"],
    ["she did not clean the bed", "she did not clean the bed"],
    ["she didn't answer the phone", "she didn't answer the phone"],
  ])("%s → %s", (said, expected) => {
    expect(fact(said)).toBe(expected);
  });

  it.each([
    "she maybe forgot",
    "i think she yelled at a guest",
    "she might have yelled at a guest",
    "she probably forgot to clean the bed",
    "not sure but she yelled at a guest",
    "possibly she left the drawer open",
    "apparently she yelled at a guest",
    "she had a verbal last month",
    "last week she also yelled at a guest",
    "she has been late 3 times this month",
    "she was previously warned about her phone",
    "she was not late",
    "she didn't yell at a guest",
    "it happened at north platte",
    "it was on 11/3",
    "she works as a tanning consultant",
    "she gets a verbal warning",
  ])("%s → no fact", (said) => {
    expect(fact(said)).toBeNull();
  });
});
