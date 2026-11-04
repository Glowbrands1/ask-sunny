import { afterEach, describe, expect, it } from "vitest";

import { acceptedCaOffer, caOfferLine } from "./ca-offer";

/**
 * CA_SALES_POLICY_ENABLED, Pau's message #5 (4 Nov 2026): a policy answer
 * about an employee the roster recognises ends with ONE offer; the card opens
 * only on "yes". Names invented (the repository is public).
 */

const FLAG = "CA_SALES_POLICY_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

const P5 = "Ysolde Marrowick did not follow must see behaviors which violates standards of conduct policy";
const ROSTER = [{ id: "e-1", firstName: "Ysolde", lastName: "Marrowick", salonIds: ["salon-1"] }];
const offer = (question: string, roster = ROSTER) => caOfferLine({ history: [], question, roster });

describe("the offer", () => {
  it("off: nothing is offered (as on main)", () => {
    delete process.env[FLAG];
    expect(offer(P5)).toBeNull();
  });

  it("on: #5 ends with one offer, for the rostered employee, citing the Standards of Conduct", () => {
    process.env[FLAG] = "true";
    expect(offer(P5)).toBe(
      "**Do you want a Corrective Action for Ysolde Marrowick?** Say **yes** and I'll start it, citing the **Standards of Conduct**.",
    );
  });

  it("on: no offer for someone the roster does not recognise", () => {
    process.env[FLAG] = "true";
    expect(offer(P5, [])).toBeNull();
  });

  it("on (negative control): a general policy question with no employee named gets no offer", () => {
    process.env[FLAG] = "true";
    expect(offer("what does the standards of conduct policy say about must see behaviors?")).toBeNull();
  });

  it("on: no offer for the general conduct reading of unfinished cleaning (sf-s15; a cleaning CA does not cite the Standards of Conduct by default)", () => {
    process.env[FLAG] = "true";
    expect(offer("Write me a CA for Ysolde Marrowick for failing to complete opening duties. Ysolde did not complete daily cleaning duties. on november 2, 2026")).toBeNull();
  });

  it("on: an MSB account is offered with the Standards of Conduct", () => {
    process.env[FLAG] = "true";
    expect(offer("Ysolde Marrowick for msb this week")).toMatch(/Standards of Conduct/);
  });

  it("on: no offer when the words read as no single policy", () => {
    process.env[FLAG] = "true";
    expect(offer("Ysolde Marrowick is working Saturday")).toBeNull();
  });
});

describe("the yes", () => {
  const offered = [
    { role: "user", content: P5 },
    { role: "assistant", content: `A grounded answer.\n\n${"**Do you want a Corrective Action for Ysolde Marrowick?** Say **yes** and I'll start it, citing the **Standards of Conduct**."}` },
  ];

  it("on: \"yes\" to the offer is the request it offered", () => {
    process.env[FLAG] = "true";
    expect(acceptedCaOffer({ question: "yes", history: offered })).toBe(
      "Create a Corrective Action Form for Ysolde Marrowick. The policy is Standards of Conduct.",
    );
  });

  it("off: \"yes\" is read as before", () => {
    delete process.env[FLAG];
    expect(acceptedCaOffer({ question: "yes", history: offered })).toBeNull();
  });

  it("on: anything but a plain yes, or a yes with no offer just before it, is not an acceptance", () => {
    process.env[FLAG] = "true";
    expect(acceptedCaOffer({ question: "what does it say?", history: offered })).toBeNull();
    expect(acceptedCaOffer({ question: "yes", history: [...offered, { role: "assistant", content: "Something else." }] })).toBeNull();
  });
});
