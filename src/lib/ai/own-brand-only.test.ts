import { afterEach, describe, expect, it, vi } from "vitest";

import { ACTIVE_BRAND } from "@/lib/brand";

import { EXCLUDED_BRAND } from "./full-manual-context";

import { ownBrandOnly, withOwnBrandOnly } from "./own-brand-only";
import type { AskResponse } from "./types";

/*
 * OWN_BRAND_ONLY_ENABLED (Pau, 6 Nov 2026; the mirror of the sibling app's case). The other brands are never written
 * in these tests: they are read from the manual block's own pattern (`EXCLUDED_BRAND`), each alternative with its
 * optional part left off, in title case; the office alternatives (not a brand) are left out.
 */
const titled = (name: string) => name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
const OWN = ACTIVE_BRAND.brandName;
const OTHERS = EXCLUDED_BRAND.source
  .replace(/^\\b\(\?:|\)\\b$/g, "")
  .split("|")
  .filter((alternative) => !/office/.test(alternative))
  .map((alternative) => titled(alternative.replace(/\(\?:[^)]*\)\?/g, "")));
const [FIRST, SECOND] = [OTHERS.find((name) => name.split(" ").length === 1)!, OTHERS.find((name) => name.split(" ").length > 1)!];

/* The sibling app's live sentence (QA, relayed from Pau, 6 Nov 2026), mirrored: this brand first, the others from the pattern. */
const LIVE = `This applies company-wide across all brands — ${OWN}, ${FIRST}, ${SECOND} — pets are not allowed in the workplace [p.29].`;

const reply = (content: string): AskResponse => ({ content }) as AskResponse;

afterEach(() => vi.unstubAllEnvs());

describe("OWN_BRAND_ONLY_ENABLED", () => {
  it("the config names two other brands (the test's own guard)", () => {
    expect(FIRST).toBeTruthy();
    expect(SECOND).toBeTruthy();
  });

  it("off: the reply is as built (the live sentence, byte for byte)", () => {
    const live = reply(LIVE);
    expect(withOwnBrandOnly(live)).toBe(live);
  });

  it("on: the live sentence names only this brand", () => {
    vi.stubEnv("OWN_BRAND_ONLY_ENABLED", "true");
    const content = withOwnBrandOnly(reply(LIVE)).content;
    expect(content).toBe(`This applies company-wide at ${OWN} — pets are not allowed in the workplace [p.29].`);
    for (const other of OTHERS) expect(content).not.toContain(other);
  });

  it("on: a reply naming no other brand is unchanged", () => {
    vi.stubEnv("OWN_BRAND_ONLY_ENABLED", "true");
    const plain = reply(`Pets are not allowed in the workplace at ${OWN} [p.29]. "Animals are not permitted on the premises." Ask your manager about service animals.`);
    expect(withOwnBrandOnly(plain)).toBe(plain);
  });

  it("on: another brand's heading and its bullets go; this brand's stay", () => {
    const text = [
      "Holiday pay depends on the brand:",
      "",
      `- **${SECOND}** — paid holidays are New Year's Day and Easter.`,
      `- **${FIRST}** — paid holidays are Thanksgiving and Christmas only.`,
      `- **${OWN}** — paid holidays are Independence Day, Thanksgiving, Christmas, New Year's Day, and Easter [p.43].`,
      "",
      `*${FIRST}*`,
      "- Shirts: two uniform shirts provided at hire [p.16].",
      "",
      `*${OWN}*`,
      "- Shirts: any plain black, white or gray t-shirt under the branded apron [p.16].",
    ].join("\n");
    const out = ownBrandOnly(text);
    for (const other of OTHERS) expect(out).not.toContain(other);
    expect(out).toContain(`- **${OWN}** — paid holidays are Independence Day`);
    expect(out).toContain(`*${OWN}*\n- Shirts: any plain black`);
    expect(out).not.toContain("two uniform shirts");
  });

  it("on: a JBA office sentence stays byte for byte; only the other brand's sentence goes (Pau, answer \"A\")", () => {
    vi.stubEnv("OWN_BRAND_ONLY_ENABLED", "true");
    const office = "Corporate staff at the JBA office get New Year's Day, Memorial Day and Labor Day as paid holidays [p.43].";
    expect(withOwnBrandOnly(reply(office)).content).toBe(office);
    const officeLine = "- **JB & Associates Office** — any JBA franchise branded top, fitted blouse or collared shirt [p.17].";
    expect(ownBrandOnly(officeLine)).toBe(officeLine);
    const mixed = `${office} ${FIRST} staff get Thanksgiving and Christmas only.`;
    expect(ownBrandOnly(mixed)).toBe(office);
  });

  it("on: a quotation is never reworded — kept whole or dropped whole", () => {
    const quoted = `The manual says "Employees of ${OWN}, ${FIRST} and ${SECOND} must wear name tags." Name tags are required [p.15].`;
    expect(ownBrandOnly(quoted)).toBe("Name tags are required [p.15].");
  });
});
