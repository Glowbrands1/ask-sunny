import { afterEach, describe, expect, it, vi } from "vitest";

import { acceptedCaOffer, acceptedCaOfferTurn, caOfferLine, withCaOffer } from "./ca-offer";

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

describe("withCaOffer: the offer at the turn's one exit (QA's live traces, 4 Nov 2026)", () => {
  const OFFER = "**Do you want a Corrective Action for Ysolde Marrowick?** Say **yes** and I'll start it, citing the **Standards of Conduct**.";
  const choice = (templateKey: string) => ({ templateKey, templateName: templateKey, description: "" });
  afterEach(() => vi.unstubAllEnvs());

  it("a reply on any path ends with the offer", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    expect(withCaOffer({ content: "The Standards of Conduct says…", citations: [] }, OFFER).content).toBe(`The Standards of Conduct says…\n\n${OFFER}`);
  });

  it("a Coaching / Corrective Action menu is replaced by the one offer", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    const out = withCaOffer({ content: "Which form?", citations: [], formSelection: { primary: choice("coaching"), additional: [choice("dpoa")] } }, OFFER);
    expect(out.formSelection).toBeUndefined();
    expect(out.content.match(/Do you want a Corrective Action for/g)).toHaveLength(1);
  });

  it("a menu without the Corrective Action Form, a card, or a reply already offering is left as it is", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    const menu = { content: "Which form?", citations: [], formSelection: { primary: choice("coaching"), additional: [] } };
    expect(withCaOffer(menu, OFFER)).toBe(menu);
    const card = { content: "Here is the card.", citations: [], formProposal: { templateKey: "dpoa" } };
    expect(withCaOffer(card, OFFER)).toBe(card);
    const offered = { content: `Answer.\n\n${OFFER}`, citations: [] };
    expect(withCaOffer(offered, OFFER)).toBe(offered);
  });

  it("off, or no offer line: unchanged", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "false");
    const reply = { content: "Answer.", citations: [] };
    expect(withCaOffer(reply, OFFER)).toBe(reply);
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    expect(withCaOffer(reply, null)).toBe(reply);
  });
});

describe("the offer names the employee of THIS message, and a menu's question goes with the menu", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("an earlier request in the chat for another employee does not name the offer", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    const roster = [
      { id: "e1", firstName: "Ysolde", lastName: "Marrowick", preferredFirstName: null },
      { id: "e2", firstName: "Thaddeus", lastName: "Quillane", preferredFirstName: null },
    ] as never;
    const line = caOfferLine({
      history: [{ id: "u1", role: "user", content: "create a corrective action for Thaddeus Quillane for being late to his shift on 11/2" }] as never,
      question: "Ysolde Marrowick did not follow must see behaviors which violates standards of conduct policy",
      roster,
    });
    expect(line).toMatch(/Corrective Action for Ysolde Marrowick\?/);
  });

  it("the suggestion's lead is dropped with its menu", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    const out = withCaOffer(
      { content: "A grounded answer.\n\nBased on what you've described, I can prepare:", citations: [], formSelection: { primary: { templateKey: "dpoa", templateName: "", description: "" }, additional: [] } },
      "**Do you want a Corrective Action for Ysolde Marrowick?** Say **yes** and I'll start it, citing the **Standards of Conduct**.",
    );
    expect(out.content).toBe("A grounded answer.\n\n**Do you want a Corrective Action for Ysolde Marrowick?** Say **yes** and I'll start it, citing the **Standards of Conduct**.");
  });
});

describe("CA_OFFER_KEEPS_ACCOUNT_ENABLED: \"yes\" is answered as the turn the offer answered (QA's MSB case M5)", () => {
  afterEach(() => vi.unstubAllEnvs());

  const OFFERED = "A grounded answer.\n\n**Do you want a Corrective Action for Ysolde Marrowick?** Say **yes** and I'll start it, citing the **Standards of Conduct**.";
  const history = [
    { id: "u0", role: "user", content: "what is the dress code?" },
    { id: "a0", role: "assistant", content: "The dress code is …" },
    { id: "u1", role: "user", content: P5 },
    { id: "a1", role: "assistant", content: OFFERED },
  ];

  it("off: null, and the yes is the rewritten request as before", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    expect(acceptedCaOfferTurn({ question: "yes", history })).toBeNull();
    expect(acceptedCaOffer({ question: "yes", history })).toBe("Create a Corrective Action Form for Ysolde Marrowick. The policy is Standards of Conduct.");
  });

  it("on without CA_SALES_POLICY_ENABLED: null (there is no offer)", () => {
    vi.stubEnv("CA_OFFER_KEEPS_ACCOUNT_ENABLED", "true");
    expect(acceptedCaOfferTurn({ question: "yes", history })).toBeNull();
  });

  it("on: her own turn, unchanged, as a Corrective Action Form, with the chat as it stood when she said it", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    vi.stubEnv("CA_OFFER_KEEPS_ACCOUNT_ENABLED", "true");
    const kept = acceptedCaOfferTurn({ question: "yes", history });
    expect(kept?.account).toEqual({ id: "u1", role: "user", content: P5 });
    expect(kept?.templateKey).toBe("dpoa");
    expect(kept?.history.map((turn) => turn.id)).toEqual(["u0", "a0"]);
    // Nothing the app wrote is her account: not the offer, not the rewritten request.
    expect(JSON.stringify(kept)).not.toMatch(/The policy is|Do you want a Corrective Action/);
  });

  it("on: no accepted offer (not a yes, or the last reply made no offer) is null", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    vi.stubEnv("CA_OFFER_KEEPS_ACCOUNT_ENABLED", "true");
    expect(acceptedCaOfferTurn({ question: "no thanks", history })).toBeNull();
    expect(acceptedCaOfferTurn({ question: "yes", history: history.slice(0, 2) })).toBeNull();
  });

  it("on: an offer with no manager turn before it is null", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    vi.stubEnv("CA_OFFER_KEEPS_ACCOUNT_ENABLED", "true");
    expect(acceptedCaOfferTurn({ question: "yes", history: [{ id: "a1", role: "assistant", content: OFFERED }] })).toBeNull();
  });
});
