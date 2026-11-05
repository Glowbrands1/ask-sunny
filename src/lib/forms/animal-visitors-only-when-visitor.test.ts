import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { specificTopic } = await import("./specific-policy-topics");

/*
 * Pau, 5 Nov 2026 ("I choose 1", and her OK for this one word list): an animal
 * alone cites Animals in the Workplace only; Visitors in the Workplace is
 * cited beside it only when the animal is a customer's, guest's, visitor's,
 * friend's or family member's. People invented.
 */
const KITTEN = "create a ca for corwin hale at kearney. he brought his new kitten to the salon on 11-4-26. verbal. no payroll deduct";
const CUSTOMER_DOG = "create a ca for corwin hale at kearney. a customer brought her dog into the salon on 11-4-26 and corwin let them stay. verbal. no payroll deduct";
const VISITORS = "Visitors in the Workplace";

beforeEach(() => {
  vi.stubEnv("POLICY_SPECIFIC_TOPICS_ENABLED", "true");
  vi.stubEnv("ANIMAL_VISITORS_ONLY_WHEN_VISITOR_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("ANIMAL_VISITORS_ONLY_WHEN_VISITOR_ENABLED", "true");
const also = (text: string) => specificTopic(text)?.also ?? null;

describe("ANIMAL_VISITORS_ONLY_WHEN_VISITOR_ENABLED", () => {
  it("flag off: an animal alone also cites Visitors in the Workplace (as before)", () => {
    expect(specificTopic(KITTEN)?.id).toBe("animals");
    expect(also(KITTEN)).toEqual([VISITORS]);
  });

  it("flag on: an animal alone is Animals in the Workplace only", () => {
    on();
    expect(specificTopic(KITTEN)?.id).toBe("animals");
    expect(also(KITTEN)).toEqual([]);
  });

  it.each([
    CUSTOMER_DOG,
    "she let her friend's dog stay in the back room during her shift",
    "a guest's puppy was in the salon and he played with it at the counter",
    "his family member came in with a cat and he let it stay at the salon",
    "a client walked in with her puppy and he let it stay at the counter",
    "she allowed a dog that belonged to a visitor in the salon",
  ])("flag on: %s also cites Visitors in the Workplace", (text) => {
    on();
    expect(specificTopic(text)?.id).toBe("animals");
    expect(also(text)).toEqual([VISITORS]);
  });

  it("flag on: customers who only saw the animal do not make it a visitor's", () => {
    on();
    const text = "he brought his puppy to the salon and customers saw it at the counter";
    expect(specificTopic(text)?.id).toBe("animals");
    expect(also(text)).toEqual([]);
  });
});
