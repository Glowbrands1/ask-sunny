import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { specificTopic } from "./specific-policy-topics";

/*
 * ANIMAL_ANYWHERE_ENABLED, Pau 27 Oct 2026: a puppy, kitten, dog, cat or pet
 * anywhere in a sentence about the employee at work is the Animals in the
 * Workplace incident. The exclusions stay. Lowercase and Sentence case.
 */
const FLAGS = ["POLICY_SPECIFIC_TOPICS_ENABLED", "ANIMAL_ANYWHERE_ENABLED"];
const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of FLAGS) {
    saved.set(name, process.env[name]);
    process.env[name] = "true";
  }
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const AT_WORK = [
  "brought her new kitten to the salon",
  "came in to show her team her new puppy",
  "she had her dog in the salon",
  "on 10-22-26 ivy was not scheduled to work and came into the salon to show her team her new puppy",
  "she let the customers pet her cat at the counter",
  "two puppies were running around the break room during her shift",
];
const sentence = (text: string) => text.replace(/^([a-z])/, (letter) => letter.toUpperCase());

describe("ANIMAL_ANYWHERE_ENABLED on", () => {
  it.each([...AT_WORK, ...AT_WORK.map(sentence)])("%s: Animals in the Workplace", (text) => {
    expect(specificTopic(text)?.id).toBe("animals");
  });

  it.each([
    "she brought a service animal to her shift",
    "she was eating a hot dog at the counter",
    "she talked about her guinea pig with the team",
    "she did not bring her dog to the salon",
  ])("%s: not the animals incident", (text) => {
    expect(specificTopic(text)?.id).not.toBe("animals");
  });

  it("an animal not at work is not it", () => {
    expect(specificTopic("she said her puppy was sick last weekend")?.id).not.toBe("animals");
  });
});

describe("ANIMAL_ANYWHERE_ENABLED off: as main", () => {
  it("the puppy after the salon is not read", () => {
    delete process.env.ANIMAL_ANYWHERE_ENABLED;
    expect(specificTopic(AT_WORK[3]!)).toBeNull();
  });
});
