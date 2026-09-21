import { describe, expect, it } from "vitest";

import {
  SDIT_EPP_INTAKE,
  deferredExpectations,
  deferredProductivity,
  eppIntakeRequest,
  readEppIntake,
} from "./epp-intake";

/**
 * ============================================================================
 * THE INTAKE ASKS FOR WHAT IS MISSING, AND NOTHING THE MANAGER ALREADY SAID
 * ============================================================================
 *
 * The behaviour under test is mostly a REFUSAL to ask. A manager who has
 * described an employee in one sentence and is then handed eleven numbered
 * questions has been given more work than the paperwork this replaces, which
 * is the failure the previous generation of this workflow had.
 */

const read = (text: string, known = { employeeKnown: true, salonSettled: true }) =>
  readEppIntake({ text, ...known });

const missingKeys = (text: string, known?: { employeeKnown: boolean; salonSettled: boolean }) =>
  read(text, known).missing.map((item) => item.key);

/* ==================================================== what is already here == */

describe("reusing what the conversation already contains", () => {
  const CONVERSATION =
    "Jessica is an SDIT at Lincoln South. She's great with clients but she's been late several times this month.";

  it("does not ask again for anything that sentence answered", () => {
    const reading = read(CONVERSATION);

    expect(reading.supplied).toContain("job_title");
    expect(reading.supplied).toContain("succeeding");
    expect(reading.supplied).toContain("needs_improvement");
    expect(reading.supplied).toContain("employee_name");
    expect(reading.supplied).toContain("salon");

    expect(missingKeys(CONVERSATION)).not.toContain("succeeding");
    expect(missingKeys(CONVERSATION)).not.toContain("needs_improvement");
    expect(missingKeys(CONVERSATION)).not.toContain("job_title");
  });

  it("still asks for the things that sentence did not answer", () => {
    // The date and the follow-up are real gaps, and they are the only required
    // ones left. Naming them is the whole value of reading the rest.
    expect(read(CONVERSATION).missingRequired.map((item) => item.key)).toEqual([
      "form_date",
      "follow_up",
    ]);
  });

  it("does not treat the form's own date as the follow-up date", () => {
    /*
     * TWO DIFFERENT QUESTIONS. A manager who says "today" has dated the form
     * and has said nothing about when the review happens; reading one as the
     * other would put a follow-up on the plan that nobody agreed to.
     */
    const reading = read("Today. She's great with clients but late a lot.");
    expect(reading.supplied).toContain("form_date");
    expect(reading.supplied).not.toContain("follow_up");

    const both = read("Today, and we'll re-evaluate the week of October 5.");
    expect(both.supplied).toContain("form_date");
    expect(both.supplied).toContain("follow_up");
  });

  it("knows it has been told nothing when the manager only clicked the card", () => {
    /*
     * The picker sends the form's name and nothing else. The salon is settled
     * by the account, and counting that would hide the intake from everybody
     * who actually uses this product.
     *
     * AND THIS FORM'S NAME IS A JOB TITLE, which is the trap: "SDIT" inside
     * "Create an SDIT EPP from this conversation" is the document's name, not
     * something the manager said about the employee.
     */
    const clicked = read("Create an SDIT EPP from this conversation.", {
      employeeKnown: false,
      salonSettled: true,
    });
    expect(clicked.nothingSupplied).toBe(true);
    expect(clicked.supplied).toEqual(["salon"]);
    expect(clicked.supplied).not.toContain("job_title");

    /*
     * AND NAMING SOMEBODY IS SAYING SOMETHING. A manager who wrote the
     * employee's name earlier gets the gaps chased, not the full list — the
     * employee is the one thing on this intake they cannot have supplied by
     * clicking a card.
     */
    expect(
      read("Create an SDIT EPP from this conversation.", {
        employeeKnown: true,
        salonSettled: true,
      }).nothingSupplied,
    ).toBe(false);

    // The same words, said about a person, still answer the job title.
    expect(read("Jessica is an SDIT").supplied).toContain("job_title");
  });
});

/* ======================================================= what never blocks == */

describe("nothing optional holds up a plan that can be drafted", () => {
  it("treats the productivity numbers and the expectation marks as optional", () => {
    const optional = SDIT_EPP_INTAKE.filter((item) => item.optional).map((item) => item.key);
    expect(optional).toEqual([
      "employee_productivity",
      "salon_productivity",
      "expectations_success",
      "expectations_improvement",
      "job_title",
    ]);
  });

  it("is complete without a single productivity figure", () => {
    const reading = read(
      "Today. Paulyne is great with clients, needs to work on punctuality, and we'll re-evaluate the week of October 5.",
    );
    expect(reading.missing.map((item) => item.key)).toContain("employee_productivity");
    expect(reading.complete).toBe(true);
  });

  it("reads a refusal to supply numbers as an answer, not as a gap", () => {
    for (const said of [
      "I don't have them",
      "leave them blank",
      "placeholder for now",
      "I'll add them later",
      "no productivity yet",
      /*
       * NAMING THE THING THEY DO NOT HAVE IS STILL SAYING SO. The object list
       * used to be pronouns plus "the numbers", so a manager who wrote out
       * what was missing read as having answered nothing — and was chased for
       * a figure they had just said they did not have.
       */
      "I don't have productivity yet",
      "I don't have her numbers",
      "we do not have the stats",
    ]) {
      expect(deferredProductivity(said), said).toBe(true);
      const reading = read(`Today. Great with clients, needs punctuality work, ${said}, re-evaluate the week of October 5.`);
      expect(reading.supplied, said).toContain("employee_productivity");
      expect(reading.supplied, said).toContain("salon_productivity");
    }
  });

  it("takes the figures when the manager does give them", () => {
    const reading = read(
      "Employee productivity number is placeholder 10, the salon's current productivity number is 20.",
    );
    expect(reading.supplied).toContain("employee_productivity");
    expect(reading.supplied).toContain("salon_productivity");
  });

  it("reads 'I'll add those later' about the expectations as an answer", () => {
    expect(deferredExpectations("I will add those later")).toBe(true);
    const reading = read("Great with clients, punctuality needs work, I'll add those later.");
    expect(reading.supplied).toContain("expectations_success");
    expect(reading.supplied).toContain("expectations_improvement");
  });
});

/* ============================================================== the asking == */

describe("the opening ask", () => {
  it("opens the way the business opens it, with the real date", () => {
    const asked = eppIntakeRequest({
      formName: "SDIT EPP",
      items: SDIT_EPP_INTAKE,
      opening: true,
      today: "September 21, 2026",
    });

    expect(asked).toContain("For the **SDIT EPP**, I'll need a few details to create it for you:");
    expect(asked).toContain("September 21, 2026");
    expect(asked).toContain("there are seven");
    // And it says which policy it will check, because that is the promise it
    // can actually keep.
    expect(asked).toContain("JB & Associates");
    expect(asked.toLowerCase()).not.toContain("driven to shine");
  });

  it("chases only the gaps once something has been said", () => {
    const reading = read("Jessica is an SDIT, great with clients, late several times.");
    const asked = eppIntakeRequest({
      formName: "SDIT EPP",
      items: reading.missingRequired,
      opening: false,
    });

    expect(asked).toContain("I have most of it. Still missing:");
    expect(asked).not.toContain("succeeding");
    expect(asked).toContain("follow-up review");
  });

  it("uses the singular when one thing is left", () => {
    expect(
      eppIntakeRequest({ formName: "SDIT EPP", items: [SDIT_EPP_INTAKE[9]!], opening: false }),
    ).toContain("One more thing and I can draft it:");
  });
});
