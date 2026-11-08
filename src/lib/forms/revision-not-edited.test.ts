import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POLICY_EDITED_TITLE, policyAcknowledgementWording, policyWordingEdited, type PolicyEventRow } from "./policy-verification";

/*
 * REVISION_EDIT_NEEDS_EDIT_ENABLED (QA's Sunny round-5 live tester, 8 Nov 2026, item 1): "Change <A> CA" opened a new
 * draft of the finalized form, and its banner said "You edited the policy wording: 'Direct policy from official
 * manual' was changed by hand" although nobody had edited anything. The carried Direct policy was unverified.
 */
const CARRIED = [{ key: "policy_language", filled: true }];
const FRESH: PolicyEventRow[] = [{ kind: "created" }, { kind: "revised" }];
const EDITED: PolicyEventRow[] = [...FRESH, { kind: "edited", detail: { fields: 1, groups: 0, rejected: [] } }];

beforeEach(() => vi.stubEnv("REVISION_EDIT_NEEDS_EDIT_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("REVISION_EDIT_NEEDS_EDIT_ENABLED", () => {
  it("off: a fresh revision's carried, unverified policy field is called an edit (the bug)", () => {
    vi.stubEnv("REVISION_EDIT_NEEDS_EDIT_ENABLED", "");
    expect(policyWordingEdited(CARRIED, FRESH, true)).toBe(true);
  });

  it("on: a fresh revision nobody edited is not called an edit, at Finalize either", () => {
    expect(policyWordingEdited(CARRIED, FRESH, true)).toBe(false);
    expect(policyAcknowledgementWording(CARRIED, FRESH, true).title).not.toBe(POLICY_EDITED_TITLE);
  });

  it("on: once the revision has an edit of its own, it is called an edit as before", () => {
    expect(policyWordingEdited(CARRIED, EDITED, true)).toBe(true);
  });

  it("on: an edit event that changed nothing is not an edit", () => {
    expect(policyWordingEdited(CARRIED, [...FRESH, { kind: "edited", detail: { fields: 0, groups: 0 } }], true)).toBe(false);
  });

  it("on: a form that is not a revision is unchanged (Sunny wrote the field, so a person's change is an edit)", () => {
    const drafted: PolicyEventRow[] = [{ kind: "drafted", detail: { fields: ["policy_language"] } }];
    expect(policyWordingEdited(CARRIED, drafted, false)).toBe(true);
    expect(policyWordingEdited(CARRIED, [], false)).toBe(false);
  });
});
