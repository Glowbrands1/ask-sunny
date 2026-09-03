import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  admitDelivery,
  APPROVED_SENDERS_ENV,
  approvedSenders,
  approvedSendersConfigured,
  extractEmailAddress,
  isApprovedSender,
  subjectNamesCompReport,
} from "./delivery-gate";

/**
 * WHO MAY FILE A COMP REPORT BY EMAIL, AND WHICH OF THEIR MAILS COUNTS.
 *
 * `Paulyne.Camacho@glowbrands.com` is the operator's own address and is here as
 * the test sender the allowlist has to admit today and stop admitting later
 * without a code change. `Samuel.Brockie@glowbrands.com` is the real sender.
 * Everything else in this file is invented.
 *
 * The tests worth reading are the negative ones. This gate decides whether an
 * inbound email becomes salon financials, so the failure that matters is the
 * one where a rule is looser than it looks — a domain suffix, a display name
 * carrying a second address, a case difference.
 */

const TEST_SENDER = "Paulyne.Camacho@glowbrands.com";
const SAMUEL = "Samuel.Brockie@glowbrands.com";
const BOTH = `${TEST_SENDER}, ${SAMUEL}`;

beforeEach(() => {
  process.env[APPROVED_SENDERS_ENV] = BOTH;
});

afterEach(() => {
  delete process.env[APPROVED_SENDERS_ENV];
});

describe("reading the allowlist", () => {
  it("normalizes case and whitespace", () => {
    process.env[APPROVED_SENDERS_ENV] = `  ${TEST_SENDER.toUpperCase()} ,  ${SAMUEL}  `;
    expect(approvedSenders()).toEqual([
      TEST_SENDER.toLowerCase(),
      SAMUEL.toLowerCase(),
    ]);
  });

  it("tolerates a trailing comma, semicolons and newlines", () => {
    process.env[APPROVED_SENDERS_ENV] = `${TEST_SENDER},\n${SAMUEL};`;
    expect(approvedSenders()).toHaveLength(2);
  });

  it("drops entries that are not addresses", () => {
    process.env[APPROVED_SENDERS_ENV] = `${SAMUEL}, not-an-address, `;
    expect(approvedSenders()).toEqual([SAMUEL.toLowerCase()]);
  });

  it("de-duplicates", () => {
    process.env[APPROVED_SENDERS_ENV] = `${SAMUEL},${SAMUEL.toUpperCase()}`;
    expect(approvedSenders()).toHaveLength(1);
  });

  it("treats unset as no senders at all", () => {
    delete process.env[APPROVED_SENDERS_ENV];
    expect(approvedSenders()).toEqual([]);
    expect(approvedSendersConfigured()).toBe(false);
  });
});

describe("reading the From header", () => {
  it("takes the address out of a display-name header", () => {
    expect(extractEmailAddress(`Samuel Brockie <${SAMUEL}>`)).toBe(SAMUEL.toLowerCase());
  });

  it("accepts a bare address", () => {
    expect(extractEmailAddress(SAMUEL)).toBe(SAMUEL.toLowerCase());
  });

  it("prefers the angle-bracketed address over anything in the display name", () => {
    /*
     * THE ATTACK THIS CLOSES. A display name can contain anything, including a
     * real approved address put there to be mistaken for the sender. The
     * bracketed address is the one the transport actually used.
     */
    expect(extractEmailAddress(`"${SAMUEL}" <attacker@invented.test>`)).toBe(
      "attacker@invented.test",
    );
  });

  it("returns null for nothing usable", () => {
    for (const value of [null, undefined, "", "   ", "not an address", "a@b@c"]) {
      expect(extractEmailAddress(value)).toBeNull();
    }
  });
});

describe("the approved sender check", () => {
  it("admits the operator's test address", () => {
    expect(isApprovedSender(TEST_SENDER)).toBe(true);
    expect(isApprovedSender(`Paulyne Camacho <${TEST_SENDER}>`)).toBe(true);
  });

  it("admits Samuel", () => {
    expect(isApprovedSender(SAMUEL)).toBe(true);
    expect(isApprovedSender(`Brockie, Samuel <${SAMUEL.toLowerCase()}>`)).toBe(true);
  });

  it("refuses anybody else, including a colleague on the same domain", () => {
    /*
     * EXACT MATCHES ONLY, and this is why. A domain rule would let any of
     * hundreds of colleagues file reporting figures by replying to the thread.
     */
    expect(isApprovedSender("someone.else@glowbrands.com")).toBe(false);
    expect(isApprovedSender("curt.bowen@glowbrands.com")).toBe(false);
  });

  it("refuses a lookalike domain", () => {
    // A suffix match on "@glowbrands.com" would also match this.
    expect(isApprovedSender("samuel.brockie@notglowbrands.com")).toBe(false);
    expect(isApprovedSender("samuel.brockie@glowbrands.com.invented.test")).toBe(false);
  });

  it("refuses a subaddressed variant of an approved address", () => {
    // `+tag` is a different address as far as an exact match is concerned, and
    // treating it as the same would let anyone who knows the address craft one.
    expect(isApprovedSender("samuel.brockie+forward@glowbrands.com")).toBe(false);
  });

  it("refuses everything when the list is unset", () => {
    delete process.env[APPROVED_SENDERS_ENV];
    expect(isApprovedSender(SAMUEL)).toBe(false);
  });

  it("stops admitting the test address once it is removed from the variable", () => {
    // The whole point of the variable: this is a configuration change, not a
    // code change.
    process.env[APPROVED_SENDERS_ENV] = SAMUEL;
    expect(isApprovedSender(SAMUEL)).toBe(true);
    expect(isApprovedSender(TEST_SENDER)).toBe(false);
  });
});

describe("the subject filter", () => {
  it("accepts the real subjects, whatever the date", () => {
    for (const subject of [
      "Comp Report 2026 08 30 - Bowen, Curt",
      "Comp Report 2026 09 30 - Bowen, Curt",
      "Comp Report TEST",
      "FW: Comp Report 2026 10 31 - Bowen, Curt",
      "RE: comp report 2027 01 31",
    ]) {
      expect(subjectNamesCompReport(subject), subject).toBe(true);
    }
  });

  it("tolerates collapsed and doubled whitespace", () => {
    expect(subjectNamesCompReport("Comp  Report 2026 08 30")).toBe(true);
    expect(subjectNamesCompReport("  Comp\tReport  ")).toBe(true);
  });

  it("ignores an unrelated subject", () => {
    for (const subject of [
      "Weekly KPI Report",
      "Salon Bonus 2026 08",
      "Out of office",
      "Report",
      "Comp",
      "",
      null,
    ]) {
      expect(subjectNamesCompReport(subject), String(subject)).toBe(false);
    }
  });
});

describe("both gates together", () => {
  it("admits an approved sender with a Comp Report subject", () => {
    expect(
      admitDelivery({ from: `Samuel Brockie <${SAMUEL}>`, subject: "Comp Report 2026 09 30" }),
    ).toEqual({ admit: true });
  });

  it("refuses an unapproved sender before it looks at the subject", () => {
    const outcome = admitDelivery({
      from: "stranger@invented.test",
      subject: "Comp Report 2026 09 30",
    });
    expect(outcome.admit).toBe(false);
    if (!outcome.admit) expect(outcome.code).toBe("sender_not_approved");
  });

  it("refuses an approved sender's unrelated mail", () => {
    const outcome = admitDelivery({ from: SAMUEL, subject: "Lunch?" });
    expect(outcome.admit).toBe(false);
    if (!outcome.admit) expect(outcome.code).toBe("subject_not_matched");
  });

  it("admits nobody when the list is unset", () => {
    // Fail CLOSED, rather than defaulting to everybody — which is the failure
    // that would actually matter here.
    delete process.env[APPROVED_SENDERS_ENV];
    const outcome = admitDelivery({ from: SAMUEL, subject: "Comp Report" });
    expect(outcome.admit).toBe(false);
    if (!outcome.admit) expect(outcome.code).toBe("not_configured");
  });

  it("never names the allowlist or its contents in a returned reason", () => {
    /*
     * The reason travels into an HTTP response. A prober learning "that address
     * is not approved" learns the shape of the list; learning which addresses
     * ARE on it would be worse.
     */
    const outcome = admitDelivery({ from: "stranger@invented.test", subject: "Comp Report" });
    if (!outcome.admit) {
      expect(outcome.operatorReason).not.toContain(SAMUEL);
      expect(outcome.operatorReason).not.toContain(TEST_SENDER);
      expect(outcome.operatorReason).not.toContain("stranger@invented.test");
      expect(outcome.operatorReason).not.toContain(APPROVED_SENDERS_ENV);
    }
  });
});
