import "server-only";

import type { WovenTeamCredentials } from "./config";
import { ACTIVE_COMPANY_CLASS, ACTIVE_COMPANY_TAG, COMPANY_SELECTION_MARKER, LOGIN_FIELDS, LOGIN_PAGE_PATH, LOGIN_SUBMIT_PATH } from "./contract";
import { attr, elementsByTag, hasClass, parseHtmlDocument, textOf } from "./html";
import { hiddenInputValue, isLoginPath, looksLikeLoginPage, safePath, WovenTeamError, type PageResponse, type WovenTeamClient } from "./http";

/**
 * ============================================================================
 * THE WOVEN TEAM SESSION — invisible to administrators, isolated in code
 * ============================================================================
 *
 * VERIFIED STEPS (the handoff):
 *   1. `GET /Login`, reading `__RequestVerificationToken` and the hidden
 *      `IsLocationLogin` / `SetTermsSignedDate` values from the form.
 *   2. `POST /Login/Authenticate` with those and the integration account's
 *      `AuthenticationRequestUser` / `AuthenticationRequestPass`.
 *
 * UNVERIFIED STEP, ISOLATED: after credentials Woven showed "Select Company".
 * That exchange was not captured, so it lives behind `CompanySelector`, whose
 * default implementation recognises the step and stops with
 * `company_selection_unverified` — precisely, before any content is read.
 * When the browser evidence arrives, a real selector replaces
 * `unverifiedCompanySelector` and nothing else changes.
 *
 * COMPANY CHECK, ALWAYS: after sign-in, the account dropdown
 * (`a.dropdown-toggle`, verified) must show the configured company (JB &
 * Associates). A sign-in that lands anywhere else is refused before a single
 * list is read.
 *
 * The session is re-established automatically when a read finds it expired;
 * see `WovenKnowledgeConnector.withSession`.
 */

export interface CompanySelector {
  /** Given the page shown after credentials, completes company selection and returns the page it lands on. */
  select(page: PageResponse, company: string, client: WovenTeamClient): Promise<PageResponse>;
}

export const unverifiedCompanySelector: CompanySelector = {
  async select() {
    throw new WovenTeamError(
      "company_selection_unverified",
      "Woven asked which company to open, and Ask Sunny does not yet know how to answer that step.",
      { path: LOGIN_SUBMIT_PATH },
    );
  },
};

export interface CompanyVerifier {
  /** The active company as the page shows it, or null when it cannot be confirmed. */
  activeCompany(page: PageResponse, expected: string): string | null;
}

function normalizeCompany(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * VERIFIED marker: the authenticated account dropdown, `a.dropdown-toggle`,
 * shows the ACTIVE company's name. Only that element is read, so a company
 * merely listed elsewhere on the page (a switcher, a footer) does not count.
 */
export const dropdownCompanyVerifier: CompanyVerifier = {
  activeCompany(page, expected) {
    const want = normalizeCompany(expected);
    const toggles = elementsByTag(parseHtmlDocument(page.text), ACTIVE_COMPANY_TAG).filter((el) => hasClass(el, ACTIVE_COMPANY_CLASS));
    return toggles.some((el) => normalizeCompany(textOf(el)).includes(want)) ? expected : null;
  },
};

export interface SessionOptions {
  credentials: WovenTeamCredentials;
  company: string;
  selector?: CompanySelector;
  verifier?: CompanyVerifier;
}

export interface EstablishedSession {
  companyLabel: string;
  companyVerified: true;
}

/** Reads the login form's hidden values. Throws `login_page_changed` if the form is not the documented one. */
export function readLoginForm(html: string): Record<string, string> {
  const doc = parseHtmlDocument(html);
  const form = elementsByTag(doc, "form").find((f) => (attr(f, "action") ?? "").toLowerCase().endsWith(LOGIN_SUBMIT_PATH.toLowerCase()));
  const token = hiddenInputValue(doc, LOGIN_FIELDS.antiForgery);
  if (!form || !token) {
    throw new WovenTeamError("login_page_changed", "Woven's sign-in page no longer looks the way Ask Sunny expects.", {
      path: LOGIN_PAGE_PATH,
    });
  }
  const fieldNames = new Set(elementsByTag(form, "input").map((i) => attr(i, "name")));
  if (!fieldNames.has(LOGIN_FIELDS.username) || !fieldNames.has(LOGIN_FIELDS.password)) {
    throw new WovenTeamError("login_page_changed", "Woven's sign-in form fields have changed.", { path: LOGIN_PAGE_PATH });
  }
  return {
    [LOGIN_FIELDS.isLocationLogin]: hiddenInputValue(doc, LOGIN_FIELDS.isLocationLogin) ?? "",
    [LOGIN_FIELDS.setTermsSignedDate]: hiddenInputValue(doc, LOGIN_FIELDS.setTermsSignedDate) ?? "",
    [LOGIN_FIELDS.antiForgery]: token,
  };
}

export async function establishSession(client: WovenTeamClient, options: SessionOptions): Promise<EstablishedSession> {
  client.jar.clear();
  client.pageToken = null;

  const loginPage = await client.request("GET", LOGIN_PAGE_PATH, null);
  if (loginPage.status !== 200) {
    throw new WovenTeamError("login_page_changed", `Woven's sign-in page answered HTTP ${loginPage.status}.`, {
      status: loginPage.status,
      path: LOGIN_PAGE_PATH,
    });
  }
  const hidden = readLoginForm(loginPage.text);

  let landing = await client.request("POST", LOGIN_SUBMIT_PATH, {
    kind: "form",
    value: {
      [LOGIN_FIELDS.username]: options.credentials.username,
      [LOGIN_FIELDS.password]: options.credentials.password,
      ...hidden,
    },
  });

  const selectingCompany = COMPANY_SELECTION_MARKER.test(textOf(parseHtmlDocument(landing.text)));
  const backAtLogin = looksLikeLoginPage(landing.text) || (isLoginPath(safePath(landing.path)) && !selectingCompany);
  if (landing.status >= 400 || backAtLogin) {
    throw new WovenTeamError(
      "login_failed",
      "Woven did not accept the integration account's sign-in. Check the Woven username and password.",
      { status: landing.status, path: LOGIN_SUBMIT_PATH },
    );
  }

  if (selectingCompany) {
    landing = await (options.selector ?? unverifiedCompanySelector).select(landing, options.company, client);
  }

  const company = (options.verifier ?? dropdownCompanyVerifier).activeCompany(landing, options.company);
  if (!company) {
    throw new WovenTeamError(
      "company_not_verified",
      `Ask Sunny signed in to Woven but could not confirm it is working in ${options.company}, so nothing was read.`,
      { path: safePath(landing.path) },
    );
  }
  return { companyLabel: company, companyVerified: true };
}
