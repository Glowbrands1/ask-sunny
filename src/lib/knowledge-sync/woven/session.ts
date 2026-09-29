import "server-only";

import type { WovenTeamCredentials } from "./config";
import {
  ACTIVE_COMPANY_CLASS,
  ACTIVE_COMPANY_TAG,
  COMPANY_HOME_PATH,
  COMPANY_SELECTION_MARKER,
  COMPANY_SWITCH_FIELD,
  COMPANY_SWITCH_FORM_ID,
  COMPANY_SWITCH_PATH,
  LOGIN_FIELDS,
  LOGIN_PAGE_PATH,
  LOGIN_SUBMIT_PATH,
} from "./contract";
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
 * THE COMPANY, ALWAYS CONFIRMED FROM THE PAGE. After sign-in the landing page's
 * account toggle (`a.dropdown-toggle`, "Paulyne Camacho JB & Associates") must
 * name the configured company. If it does, nothing else happens.
 *
 * IF IT DOES NOT — a different company, or the login-time "Select Company"
 * screen — the company is selected with the request observed in the Switch
 * Account modal, `POST /Account/_Change_EmployeeCompany { pCompanyID }`, then
 * `/` is reloaded and the toggle is checked again. That request is
 * SOURCE-OBSERVED, not captured on the wire, and not proven to be what the
 * login-time chooser sends; so it is one replaceable `CompanySelector`, and
 * nothing is read unless the reloaded page proves the company is active.
 * `{ Success: true }` alone is never believed.
 *
 * Every failure here fails the sync closed, with a code that names the step:
 *   company_id_not_configured   selection needed, no company id to send
 *   company_selection_failed    the switch was refused or answered oddly
 *   company_not_verified        the page still does not show the company
 *   session_expired             the session ended mid-selection
 *   antiforgery_token_missing   a header is configured but no token was found
 *
 * The session is re-established automatically when a read finds it expired;
 * see `WovenKnowledgeConnector.withSession`.
 */

export interface CompanySelector {
  /**
   * Given the page shown after credentials, makes `company` the active one and
   * returns the page it lands on. The caller still verifies that page.
   */
  select(page: PageResponse, company: string, client: WovenTeamClient): Promise<PageResponse>;
}

export interface CompanyVerifier {
  /** The active company as the page shows it, or null when it cannot be confirmed. */
  activeCompany(page: PageResponse, expected: string): string | null;
}

export function normalizeCompany(value: string): string {
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

/** The selector used when no company id is configured: it can only say so. */
export const unconfiguredCompanySelector: CompanySelector = {
  async select(page, company) {
    throw new WovenTeamError(
      "company_id_not_configured",
      `Woven did not open ${company} after sign-in, and Ask Sunny has no company id to select it with. Set WOVEN_TEAM_COMPANY_ID.`,
      { path: safePath(page.path) },
    );
  },
};

/**
 * ============================================================================
 * THE SOURCE-OBSERVED SELECTOR — `POST /Account/_Change_EmployeeCompany`
 * ============================================================================
 *
 *   1. If an anti-forgery header is configured: `GET` the modal the web app
 *      loads (`/Account/_Change_EmployeeCompany`) and take the token from
 *      `form#SwitchCompanyForm`, falling back to the landing page's own. No
 *      token, no request.
 *   2. `POST` `{ "pCompanyID": companyId }` as JSON.
 *   3. Believe it only as `{ "Success": true }` — `false`, a missing or
 *      non-boolean `Success`, HTML, or a login page is a failure. Woven's
 *      `ErrorMessage` text is NOT copied into the error: responses never
 *      leave `http.ts`'s rules.
 *   4. Reload `/`, as the modal's script does, and hand that page back to be
 *      verified.
 */
export function changeEmployeeCompanySelector(companyId: string): CompanySelector {
  return {
    async select(page, company, client) {
      const where = safePath(COMPANY_SWITCH_PATH);

      if (client.antiForgeryHeader) {
        client.pageToken = await switchFormToken(client) ?? hiddenInputValue(parseHtmlDocument(page.text), LOGIN_FIELDS.antiForgery);
        if (!client.pageToken) {
          throw new WovenTeamError(
            "antiforgery_token_missing",
            "An anti-forgery header is configured, but Woven's company switch carried no token to send in it, so the company was not selected.",
            { path: where },
          );
        }
      }

      const answer = await expectingSession(() => client.postJson(COMPANY_SWITCH_PATH, { [COMPANY_SWITCH_FIELD]: companyId }));
      const success = answer && typeof answer === "object" ? (answer as Record<string, unknown>).Success : undefined;
      if (success !== true) {
        const told = answer && typeof answer === "object" && typeof (answer as Record<string, unknown>).ErrorMessage === "string";
        throw new WovenTeamError(
          "company_selection_failed",
          success === false
            ? `Woven refused to switch to ${company}${told ? " and gave a reason" : ""}. Check that the integration account belongs to ${company} and that WOVEN_TEAM_COMPANY_ID is its id.`
            : `Woven answered the company switch without saying it succeeded, so ${company} was not assumed to be selected.`,
          { status: 200, path: where },
        );
      }

      const html = await expectingSession(() => client.getHtml(COMPANY_HOME_PATH));
      return { status: 200, path: COMPANY_HOME_PATH, contentType: "text/html", text: html };
    },
  };
}

/** The modal's own anti-forgery token, or null. A modal that will not load is not fatal here. */
async function switchFormToken(client: WovenTeamClient): Promise<string | null> {
  try {
    const modal = await client.request("GET", COMPANY_SWITCH_PATH, null);
    if (modal.status !== 200 || looksLikeLoginPage(modal.text)) return null;
    const form = elementsByTag(parseHtmlDocument(modal.text), "form").find((f) => attr(f, "id") === COMPANY_SWITCH_FORM_ID);
    return form ? hiddenInputValue(form, LOGIN_FIELDS.antiForgery) : null;
  } catch (error) {
    if (error instanceof WovenTeamError && error.sessionLost) throw error;
    return null;
  }
}

/** A session that ends mid-selection is named as such, and marked lost. */
async function expectingSession<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof WovenTeamError && error.code === "session_expired") {
      throw new WovenTeamError("session_expired", "The Woven session ended while the company was being selected.", {
        status: error.status,
        path: error.path,
        sessionLost: true,
      });
    }
    throw error;
  }
}

export interface SessionOptions {
  credentials: WovenTeamCredentials;
  company: string;
  /** The company's Woven id; needed only when sign-in lands elsewhere. */
  companyId?: string | null;
  selector?: CompanySelector;
  verifier?: CompanyVerifier;
}

export interface EstablishedSession {
  companyLabel: string;
  companyVerified: true;
  /** Whether the company had to be selected after sign-in. */
  companySelected: boolean;
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

function selectorFor(options: SessionOptions): CompanySelector {
  if (options.selector) return options.selector;
  return options.companyId ? changeEmployeeCompanySelector(options.companyId) : unconfiguredCompanySelector;
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

  const landing = await client.request("POST", LOGIN_SUBMIT_PATH, {
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

  const verifier = options.verifier ?? dropdownCompanyVerifier;

  /* Already there: continue immediately, with no selection request at all. */
  const active = verifier.activeCompany(landing, options.company);
  if (active) return { companyLabel: active, companyVerified: true, companySelected: false };

  const selected = await selectorFor(options).select(landing, options.company, client);
  const confirmed = verifier.activeCompany(selected, options.company);
  if (!confirmed) {
    throw new WovenTeamError(
      "company_not_verified",
      `Ask Sunny asked Woven to open ${options.company}, but the page it landed on does not show ${options.company} as the active company, so nothing was read.`,
      { path: safePath(selected.path) },
    );
  }
  return { companyLabel: confirmed, companyVerified: true, companySelected: true };
}
