import { describe, expect, it } from "vitest";

import { describeTokenDiagnostics, diagnoseTokenResponse, redact, type DiagnoseInput } from "./token-diagnostics";

/**
 * ============================================================================
 * SIGN-IN DIAGNOSTICS — useful, and never a leak
 * ============================================================================
 *
 * Every case asserts two things: what the diagnostics conclude, and that no
 * credential, token or detail of the application user survives into them.
 */

const SECRETS = {
  subscriptionKey: "sk-live-9f8e7d6c5b4a3f2e1d0c",
  username: "ask.sunny.integration@glowbrands.test",
  password: "Pa55w0rd!-not-real",
};
const ACCESS = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
const REFRESH = "rt_8c1f4a2b9e7d6c5b4a3f2e1d0c9b8a7f";

/** Everything that must never appear in diagnostics, whatever the response. */
const FORBIDDEN = [
  SECRETS.subscriptionKey,
  SECRETS.username,
  SECRETS.password,
  ACCESS,
  REFRESH,
  "Integration",
  "Userson",
  "8d3a7c1e-5b2f-4e6a-9c8d-1f2e3a4b5c6d",
  "Operations Lead",
  "Head Office",
  "2fa-person@glowbrands.test",
  "555-201-8844",
  "Glow Brands West",
  "Glow Brands East",
];

function diagnose(overrides: Partial<DiagnoseInput>) {
  const d = diagnoseTokenResponse({
    status: 200,
    contentType: "application/json; charset=utf-8",
    text: "",
    companyIdSent: false,
    platformSent: false,
    secrets: [SECRETS.subscriptionKey, SECRETS.username, SECRETS.password],
    ...overrides,
  });
  const serialized = `${JSON.stringify(d)} ${describeTokenDiagnostics(d)}`;
  for (const forbidden of FORBIDDEN) expect(serialized, forbidden).not.toContain(forbidden);
  return d;
}

/** A spec-shaped AuthenticationJwtResponse for the integration user, with every sensitive field filled. */
function jwtResponse(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    RefreshToken: REFRESH,
    RefreshTokenExpirationDate: "2026-10-30T00:00:00",
    TwoFactorAuthentication: {
      RoleAuthority: 1,
      TwoFactorAuthenticationEnabled: false,
      TwoFactorAuthenticationCellPhone: "555-201-8844",
      EmailAddress: "2fa-person@glowbrands.test",
      RoleTwoFactorAuthentication: 1,
      Use2FA: false,
      Setup2FA: false,
    },
    EmployeeID: "8d3a7c1e-5b2f-4e6a-9c8d-1f2e3a4b5c6d",
    AccessToken: null,
    TokenExpirationDate: "0001-01-01T00:00:00",
    FirstName: "Integration",
    LastName: "Userson",
    UserName: SECRETS.username,
    PositionName: "Operations Lead",
    PrimaryLocationName: "Head Office",
    FailedLoginAttempt: false,
    AccountStatus: 1,
    HasMultipleCompanyAccess: false,
    CompanyLoginOptions: [],
    ForcePasswordChange: false,
    RequireTermsSigned: false,
    RequireOnboarding: false,
    ...overrides,
  });
}

describe("the API gateway in front of Woven", () => {
  it("an invalid subscription key (401): the gateway rejected it, the credentials were never checked", () => {
    const d = diagnose({
      status: 401,
      text: JSON.stringify({
        statusCode: 401,
        message: "Access denied due to invalid subscription key. Make sure to provide a valid key for an active subscription.",
      }),
    });
    expect(d).toMatchObject({ httpStatus: 401, contentType: "application/json", bodyKind: "json", gatewayRejectedSubscriptionKey: true, credentialsRejected: null });
    expect(d.errorFields).toEqual({
      statusCode: 401,
      message: "Access denied due to invalid subscription key. Make sure to provide a valid key for an active subscription.",
    });
    expect(describeTokenDiagnostics(d)).toContain("the API gateway rejected the subscription key");
  });

  it("an out-of-quota or inactive subscription (403)", () => {
    const d = diagnose({ status: 403, text: JSON.stringify({ statusCode: 403, message: "Out of call volume quota. Quota will be replenished in 00:10:00." }) });
    expect(d.gatewayRejectedSubscriptionKey).toBe(true);
  });
});

describe("Woven answering 200 without a token — documented login states", () => {
  it("FailedLoginAttempt: Woven rejected the username or password", () => {
    const d = diagnose({ text: jwtResponse({ FailedLoginAttempt: true }) });
    expect(d).toMatchObject({ accessTokenPresent: false, credentialsRejected: true, gatewayRejectedSubscriptionKey: false });
    expect(d.loginState.failedLoginAttempt).toBe(true);
    expect(d.responseKeys).toContain("FailedLoginAttempt");
    expect(d.responseKeys).toContain("FirstName"); // the key NAME, never its value
    expect(describeTokenDiagnostics(d)).toContain("Woven rejected the username or password");
  });

  it("a company chooser without a CompanyID sent: CompanyID appears required — counted, never named", () => {
    const d = diagnose({
      text: jwtResponse({
        HasMultipleCompanyAccess: true,
        CompanyLoginOptions: [
          { CompanyID: "11111111-2222-3333-4444-555555555555", CompanyName: "Glow Brands West" },
          { CompanyID: "66666666-7777-8888-9999-000000000000", CompanyName: "Glow Brands East" },
        ],
      }),
    });
    expect(d).toMatchObject({ companyIdAppearsRequired: true, credentialsRejected: false, companyIdSent: false });
    expect(d.loginState.companyLoginOptionCount).toBe(2);
    expect(JSON.stringify(d)).not.toContain("11111111-2222");
  });

  it("the same chooser when a CompanyID WAS sent is not read as 'CompanyID required'", () => {
    const d = diagnose({ companyIdSent: true, text: jwtResponse({ HasMultipleCompanyAccess: true, CompanyLoginOptions: [{}] }) });
    expect(d.companyIdAppearsRequired).toBeNull();
  });

  it("two-factor sign-in: flags only, never the 2FA e-mail or phone", () => {
    const d = diagnose({ text: jwtResponse({ TwoFactorAuthentication: { Use2FA: true, TwoFactorAuthenticationEnabled: true, EmailAddress: "2fa-person@glowbrands.test", TwoFactorAuthenticationCellPhone: "555-201-8844" } }) });
    expect(d.twoFactorAppearsRequired).toBe(true);
    expect(d.loginState).toMatchObject({ twoFactorEnabled: true, twoFactorInUse: true });
  });

  it("an unfinished account: password change, terms or onboarding", () => {
    const d = diagnose({ text: jwtResponse({ ForcePasswordChange: true }) });
    expect(d.accountSetupIncomplete).toBe(true);
  });

  it("an AccessToken under a differently-cased key is detected — and its value is not kept", () => {
    const d = diagnose({ text: JSON.stringify({ accessToken: ACCESS, tokenExpirationDate: "2026-10-01T00:00:00" }) });
    expect(d).toMatchObject({ accessTokenPresent: true, accessTokenKeyMismatch: true });
    expect(d.responseKeys).toEqual(["accessToken", "tokenExpirationDate"]);
    expect(describeTokenDiagnostics(d)).toContain("differs from the spec's `AccessToken`");
  });
});

describe("error bodies", () => {
  it("a 400 naming the user and a missing field: redacted message, field names, what they suggest", () => {
    const d = diagnose({
      status: 400,
      text: JSON.stringify({
        title: "One or more validation errors occurred.",
        status: 400,
        errors: { Platform: ["The Platform field is required."] },
        message: `Invalid password for ${SECRETS.username} (${SECRETS.password})`,
      }),
    });
    expect(d.errorFields.message).toBe("Invalid password for [redacted] ([redacted])");
    expect(d.errorFieldNames).toEqual(["Platform"]);
    expect(d).toMatchObject({ platformAppearsRequired: true, credentialsRejected: true, gatewayRejectedSubscriptionKey: null });
  });

  it("a 500 with a stack-trace-like message keeps only a redacted, capped message", () => {
    const d = diagnose({ status: 500, text: JSON.stringify({ Message: `An error has occurred. Token ${ACCESS} for 8d3a7c1e-5b2f-4e6a-9c8d-1f2e3a4b5c6d. ${"x".repeat(400)}` }) });
    expect(d.errorFields.Message).toMatch(/^An error has occurred\. Token \[token\] for \[id\]\. \[redacted\]$/);
    expect(String(d.errorFields.Message).length).toBeLessThanOrEqual(201);
  });

  it("an HTML page is described by kind alone", () => {
    const d = diagnose({ contentType: "text/html", text: `<!DOCTYPE html><html><body>Login for ${SECRETS.username} failed</body></html>` });
    expect(d).toMatchObject({ bodyKind: "html", contentType: "text/html", responseKeys: [], errorFields: {}, textSnippet: null });
  });

  it("an XML body is described by kind alone", () => {
    const d = diagnose({ contentType: "application/xml", text: "<AuthenticationJwtResponse><AccessToken/></AuthenticationJwtResponse>" });
    expect(d).toMatchObject({ bodyKind: "xml", textSnippet: null });
  });

  it("plain text keeps a redacted first line", () => {
    const d = diagnose({ status: 400, contentType: "text/plain", text: `Bad Request: user ${SECRETS.username} password ${SECRETS.password}\nsecond line` });
    expect(d.textSnippet).toBe("Bad Request: user [redacted] password [redacted]");
    expect(d.credentialsRejected).toBe(true);
  });

  it("an empty 200 body", () => {
    const d = diagnose({ contentType: null, text: "   " });
    expect(d).toMatchObject({ bodyKind: "empty", contentType: null, accessTokenPresent: false });
    expect(describeTokenDiagnostics(d)).toContain("The response does not say why no token was issued.");
  });
});

describe("redact", () => {
  it("scrubs secrets, e-mails, JWTs, GUIDs, long opaque runs and phone numbers", () => {
    expect(redact(`key ${SECRETS.subscriptionKey}`, [SECRETS.subscriptionKey])).toBe("key [redacted]");
    expect(redact("mail someone@example.com now", [])).toBe("mail [email] now");
    expect(redact(`bearer ${ACCESS}`, [])).toBe("bearer [token]");
    expect(redact("id 8d3a7c1e-5b2f-4e6a-9c8d-1f2e3a4b5c6d", [])).toBe("id [id]");
    expect(redact(`r ${REFRESH}`, [])).toBe("r [redacted]");
    expect(redact("call +1 (555) 201-8844", [])).toBe("call [number]");
    expect(redact("Invalid subscription key.", [])).toBe("Invalid subscription key.");
  });
});
