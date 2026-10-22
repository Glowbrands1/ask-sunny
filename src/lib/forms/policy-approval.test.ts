import { describe, expect, it } from "vitest";

import type { FormDocument } from "./document";
import {
  POLICY_UNAPPROVED_MESSAGE,
  POLICY_UNAPPROVED_TITLE,
  policyAcknowledgementWording,
  unverifiedPolicyFields,
} from "./policy-verification";

/*
 * Release requirement, 22 Oct 2026: a policy manual nobody approved is not
 * official verification. A quote from the manual an administrator TAGGED is
 * verified; the same quote from a manual found only by its title is listed as
 * unverified at finalize, with its own warning. A draft is never blocked.
 */
const DOCUMENT = {
  blocks: [
    { kind: "field", field: { key: "policy_language", label: "Direct policy from official manual", policyGrounded: true } },
  ],
} as unknown as FormDocument;

const quoted = (matchedBy: "tag" | "fallback") => ({
  fieldKey: "policy_language",
  value: "It is the responsibility of each employee to know his or her work schedule.",
  provenance: { grounded: true, verified: true, source: "official_policy_manual", matchedBy },
});

describe("an unapproved policy manual is not official verification", () => {
  it("a quote from the tagged (approved) manual is verified", () => {
    expect(unverifiedPolicyFields(DOCUMENT, null, [quoted("tag")])).toEqual([]);
  });

  it("the same quote from a manual matched only by its title asks for acknowledgement", () => {
    const fields = unverifiedPolicyFields(DOCUMENT, null, [quoted("fallback")]);
    expect(fields).toEqual([
      { key: "policy_language", label: "Direct policy from official manual", filled: true, unapprovedSource: true },
    ]);
    expect(policyAcknowledgementWording(fields, [{ kind: "drafted", detail: { fields: ["policy_language"] } }])).toEqual({
      title: POLICY_UNAPPROVED_TITLE,
      message: POLICY_UNAPPROVED_MESSAGE,
    });
  });

  it("a value with no manual behind it is unverified as before", () => {
    const fields = unverifiedPolicyFields(DOCUMENT, null, [
      { fieldKey: "policy_language", value: "Typed by hand", provenance: { verified: false } },
    ]);
    expect(fields).toEqual([{ key: "policy_language", label: "Direct policy from official manual", filled: true }]);
    expect(policyAcknowledgementWording(fields, []).title).not.toBe(POLICY_UNAPPROVED_TITLE);
  });
});
