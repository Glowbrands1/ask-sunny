import { describe, expect, it } from "vitest";

import { buildSecurityWarnings } from "@/lib/config/security-warnings";
import {
  containsNoSecretValues,
  modeBadge,
  serviceRowState,
} from "./service-status-model";

/**
 * HEALTH -> ADMIN UI MAPPING.
 *
 * The screen exists so an administrator can tell, at a glance, what is
 * configured and what is dangerous. These tests pin the two judgements it makes
 * that would be easy to get subtly wrong: what counts as a problem, and what
 * counts as merely absent.
 */

describe("serviceRowState", () => {
  it("shows a configured service as ready", () => {
    expect(serviceRowState({ configured: true, required: true })).toEqual({
      tone: "ready",
      label: "Configured",
    });
  });

  it("shows a required but unconfigured service as needing attention", () => {
    expect(serviceRowState({ configured: false, required: true })).toEqual({
      tone: "attention",
      label: "Required",
    });
  });

  it("does not alarm about a service this deployment does not need", () => {
    // Demo mode requires nothing. Painting the page amber would be noise.
    expect(serviceRowState({ configured: false, required: false })).toEqual({
      tone: "neutral",
      label: "Not needed yet",
    });
  });

  it("ranks a misconfiguration above everything, even when configured", () => {
    // A service configured WRONG is worse than one that is simply missing,
    // because it looks fine from a distance.
    expect(
      serviceRowState({ configured: true, required: true, problem: "swapped keys" }),
    ).toEqual({ tone: "failed", label: "Problem" });
  });
});

describe("modeBadge", () => {
  it("distinguishes demo from live", () => {
    expect(modeBadge("live").label).toBe("Live mode");
    expect(modeBadge("demo").label).toBe("Demo mode");
    expect(modeBadge("live").tone).not.toBe(modeBadge("demo").tone);
  });
});

describe("buildSecurityWarnings", () => {
  const base = {
    mode: "live" as const,
    authProviderKind: "none",
    authIsProductionGrade: false,
    unauthenticatedAccessAllowed: false,
    escapeHatchVariableName: "ALLOW_UNAUTHENTICATED_LIVE_ACCESS",
  };

  it("warns that protected functionality is refused when no provider exists", () => {
    const warnings = buildSecurityWarnings(base);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("No production authentication provider");
  });

  it("shouts about the escape hatch, naming the variable", () => {
    const warnings = buildSecurityWarnings({
      ...base,
      unauthenticatedAccessAllowed: true,
    });

    expect(warnings.some((w) => w.includes("ALLOW_UNAUTHENTICATED_LIVE_ACCESS"))).toBe(true);
    // The wording now makes the structural claim rather than only asking
    // nicely: the bypass is gated on NODE_ENV, not on the operator's care.
    expect(warnings.some((w) => w.includes("local pre-authentication acceptance test"))).toBe(
      true,
    );
  });

  it("does not also claim functionality is refused while the hatch is open", () => {
    // Both warnings at once would be contradictory: the hatch is precisely what
    // stops the refusal from happening.
    const warnings = buildSecurityWarnings({
      ...base,
      unauthenticatedAccessAllowed: true,
    });
    expect(warnings.some((w) => w.includes("is refused"))).toBe(false);
  });

  it("says the bypass cannot operate in production when reporting it active", () => {
    const warnings = buildSecurityWarnings({
      ...base,
      unauthenticatedAccessAllowed: true,
    });
    expect(warnings.some((w) => w.includes("cannot operate in a production build"))).toBe(
      true,
    );
  });

  it("reports a flag that was set on a production build and ignored", () => {
    const warnings = buildSecurityWarnings({
      ...base,
      unauthenticatedAccessAllowed: false,
      unauthenticatedBypassIgnoredInProduction: true,
    });

    // Not a failure — the refusal is correct. It is a signal that somebody
    // tried to turn authentication off on a production deployment.
    expect(warnings.some((w) => w.includes("permanently disabled here"))).toBe(true);
    expect(warnings.some((w) => w.includes("Remove the variable"))).toBe(true);
    expect(warnings.some((w) => w.includes("still being refused"))).toBe(true);
  });

  it("never reports the bypass as both active and ignored", () => {
    // The two states are mutually exclusive by construction; if both ever
    // appeared, the production gate would have a hole in it.
    const active = buildSecurityWarnings({ ...base, unauthenticatedAccessAllowed: true });
    expect(active.some((w) => w.includes("permanently disabled here"))).toBe(false);
  });

  it("warns when the demo switcher is somehow active in live mode", () => {
    const warnings = buildSecurityWarnings({
      ...base,
      authProviderKind: "demo",
    });
    expect(warnings.some((w) => w.includes("presentation aid"))).toBe(true);
  });

  it("is silent in demo mode, which has no server surface to protect", () => {
    expect(
      buildSecurityWarnings({
        ...base,
        mode: "demo",
        authProviderKind: "demo",
        unauthenticatedAccessAllowed: true,
      }),
    ).toEqual([]);
  });

  it("is silent once a real provider is configured", () => {
    expect(
      buildSecurityWarnings({
        ...base,
        authProviderKind: "entra_id",
        authIsProductionGrade: true,
      }),
    ).toEqual([]);
  });
});

describe("no secret ever reaches the admin screen", () => {
  it("detects a leaked value in a payload", () => {
    // Guards the guard: proves the assertion below would actually fail.
    const leaky = { services: { anthropic: { key: "sk-ant-secret" } } };
    expect(containsNoSecretValues(leaky, ["sk-ant-secret"])).toBe(false);
  });

  it("passes a payload that carries only variable names", () => {
    const safe = {
      missingEnvironmentVariables: ["ANTHROPIC_API_KEY", "SUPABASE_SECRET_KEY"],
      services: { anthropic: { configured: false, missing: ["ANTHROPIC_API_KEY"] } },
    };

    expect(
      containsNoSecretValues(safe, ["sk-ant-secret", "sb_secret_value", "sb_publishable_value"]),
    ).toBe(true);
  });

  it("ignores empty secrets rather than reporting a false leak", () => {
    expect(containsNoSecretValues({ a: 1 }, ["", ""])).toBe(true);
  });
});
