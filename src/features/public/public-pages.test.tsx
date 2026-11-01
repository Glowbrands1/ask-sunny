import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AboutPage from "@/app/about/page";
import PrivacyPage from "@/app/privacy/page";
import { PublicLinks } from "@/features/public/public-page";

/**
 * ============================================================================
 * /about AND /privacy: GOOGLE'S OAUTH CONSENT SCREEN DEPENDS ON THEM.
 * ============================================================================
 *
 * They are the homepage and privacy policy named on the consent screen of the
 * PUBLISHED Google sign-in app (Testing mode expires every login after 7 days;
 * that stopped Ask Bubbles' reviews sync on 21 Oct 2026, and this app uses the
 * same flow). Google's reviewers open them with NO Ask Sunny session.
 * Ported from Ask Bubbles.
 *
 * WHY THE PAGES ARE RENDERED rather than grepped: the assertions are about
 * what a reader sees, so a harmless reformat of the JSX must not break them,
 * and a real wording change must.
 *
 * WHY THE SOURCE IS ALSO READ: "public" is a property of WHERE the file lives
 * and WHAT it calls. A page that moved into `(app)` or started calling a page
 * guard would still render here, and would redirect Google to /login.
 */

const html = (element: React.ReactElement) =>
  renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/ ([,.])/g, "$1");

const LIMITED_USE =
  "Ask Sunny's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.";

afterEach(() => vi.unstubAllEnvs());

// An invented address: the real one is set in the deployment (see the page).
const CONTACT = "privacy.desk@example.invalid";

describe("the privacy policy", () => {
  beforeEach(() => vi.stubEnv("PRIVACY_CONTACT_EMAIL", CONTACT));
  const text = () => html(<PrivacyPage />);

  it("states the Limited Use sentence exactly", () => {
    expect(text()).toContain(LIMITED_USE);
  });

  it("names the scope, the contact and how to revoke", () => {
    const page = text();
    expect(page).toContain("business.manage");
    expect(page).toContain(CONTACT);
    expect(renderToStaticMarkup(<PrivacyPage />)).toContain(`href="mailto:${CONTACT}"`);
    expect(page).toContain("myaccount.google.com/permissions");
    expect(page).toContain("Effective November 1, 2026");
  });

  it("does not promise deletion on disconnect — disconnect keeps stored reviews", () => {
    // `/api/admin/reviews/gbp/disconnect` revokes the grant and keeps reviews.
    expect(text()).toContain("disconnecting does not by itself delete reviews already stored");
  });
});

describe("the privacy policy without a configured contact", () => {
  it("still renders, pointing readers to their administrator", () => {
    vi.stubEnv("PRIVACY_CONTACT_EMAIL", "");
    expect(html(<PrivacyPage />)).toContain("your JB & Associates administrator");
  });
});

describe("the about page", () => {
  it("links to the privacy policy", () => {
    expect(renderToStaticMarkup(<AboutPage />)).toContain('href="/privacy"');
  });
});

describe("the shared links (public footer and sign-in screen)", () => {
  it("point to /about and /privacy with relative URLs, so they work on any host", () => {
    const markup = renderToStaticMarkup(<PublicLinks />);
    expect(markup).toContain('href="/about"');
    expect(markup).toContain('href="/privacy"');
  });

  it("are on the sign-in screen", () => {
    expect(readFileSync("src/features/auth/login-screen.tsx", "utf8")).toContain("<PublicLinks");
  });
});

describe("both pages load logged out", () => {
  const GUARDS = /require(Page|Authenticated)|pageIdentity|pageCan|authorizeRequest|redirect\(/;
  const files = ["src/app/about/page.tsx", "src/app/privacy/page.tsx", "src/features/public/public-page.tsx"];

  it.each(files)("%s is outside (app) and calls no auth guard", (file) => {
    expect(file).not.toContain("(app)");
    expect(readFileSync(file, "utf8")).not.toMatch(GUARDS);
  });

  it("the middleware never redirects (it only refreshes the session)", () => {
    expect(readFileSync("src/middleware.ts", "utf8")).not.toMatch(/NextResponse\.redirect|redirect\(/);
  });

  it.each(files)("%s carries no Ask Bubbles company wording (CLAUDE.md: no cross-company content)", (file) => {
    // Brand words come from ACTIVE_BRAND; only provenance comments name the sibling.
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/buff city|glowbrands|bubbles/i);
  });
});
