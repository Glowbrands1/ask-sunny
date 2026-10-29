import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { looseFits, looseFitsOnly } from "./loose-name";

/* PARTIAL_NAME_LOOSE_MATCH_ENABLED's matcher. Invented names. */
const CAMARILLO = { name: "Marisol Camarillo", preferred: "Mari" };
const CORTEZ = { name: "Marisol Cortez", preferred: null };
const DOVETAIL = { name: "Katrin Dovetail", preferred: "Kit" };

describe("looseFits", () => {
  it.each([
    ["marisol co", CAMARILLO],
    ["marisol cam", CAMARILLO],
    ["marisol camach", { name: "Marisol Camacho", preferred: null }],
    ["marisol camrillo", CAMARILLO],
    ["mari co", CAMARILLO],
    ["mar co", CAMARILLO],
    ["katrin dovtail", DOVETAIL],
    ["kit dov", DOVETAIL],
    ["marisol", CAMARILLO],
  ])("%s fits %o", (typed, person) => expect(looseFits(typed, person)).toBe(true));

  it.each([
    ["marisol ko", CAMARILLO],
    ["marisol zz", CAMARILLO],
    ["marisol c", CAMARILLO],
    ["rowan co", CAMARILLO],
    ["marisol oc", CAMARILLO],
  ])("%s does not fit %o", (typed, person) => expect(looseFits(typed, person)).toBe(false));
});

describe("looseFitsOnly", () => {
  it("one roster person fits: the card's person", () => {
    expect(looseFitsOnly("marisol co", "Marisol Camarillo", [CAMARILLO, DOVETAIL])).toBe(true);
  });
  it("two roster people fit: nobody", () => {
    expect(looseFitsOnly("marisol co", "Marisol Camarillo", [CAMARILLO, CORTEZ])).toBe(false);
  });
  it("the one who fits is not the card's person: no", () => {
    expect(looseFitsOnly("marisol co", "Katrin Dovetail", [CAMARILLO, DOVETAIL])).toBe(false);
  });
});
