import "server-only";

import type { WovenTeamCredentials } from "./config";
import { ACTIVE_COMPANY_CLASS, ACTIVE_COMPANY_TAG, COMPANY_CHOOSER_TEXT, COMPANY_CHOOSER_TITLE, LOGIN_FIELDS, LOGIN_PAGE_PATH, LOGIN_SUBMIT_PATH } from "./contract";
import { attr, elementsByTag, hasClass, parseHtmlDocument, textOf } from "./html";
import { hiddenInputValue, safePath, WovenTeamError, type PageResponse, type WovenTeamClient } from "./http";

/**
 * ============================================================================
 * THE WOVEN TEAM SESSION — invisible to administrators, isolated in code
 * ============================================================================
 *
 * VERIFIED STEPS:
 *   1. `GET /Login`, reading `__RequestVerificationToken` and the hidden
 *      `IsLocationLogin` / `SetTermsSignedDate` values from the form.
 *   2. `POST` that form with the integration account's
 *      `AuthenticationRequestUser` / `AuthenticationRequestPass`.
 *
 * THREE OUTCOMES OF STEP 2, told apart by what the page IS — never by the URL
 * alone, because the live account chooser is served at `/Login/Authenticate`:
 *
 *   A. the credential form again (a password field) or an HTTP error
 *        → `login_failed`. The only outcome that blames the password.
 *   B. the ACCOUNT CHOOSER ("Select account for login", verified live)
 *        → credentials accepted; choose JB & Associates (below).
 *   C. anything else — normally the dashboard
 *        → the company check decides.
 *
 * CHOOSING THE COMPANY follows the chooser's own markup for the configured
 * company's entry, the way a browser would when it is clicked:
 *
 *   a same-origin link   → GET it
 *   a form submit        → submit that form, with the entry's own name/value
 *   anything else        → `company_selection_unverified`, naming what was
 *                          found (for example the script function), so the
 *                          one missing request can be captured. No route is
 *                          guessed.
 *
 * COMPANY CHECK, ALWAYS: the account dropdown (`a.dropdown-toggle`, verified)
 * must then show JB & Associates, or nothing is read.
 *
 * The session is re-established automatically when a read finds it expired;
 * see `WovenKnowledgeConnector.withSession`.
 */

export interface CompanySelector {
  /** Given the chooser page, completes company selection and returns the page it lands on. */
  select(page: PageResponse, company: string, client: WovenTeamClient): Promise<PageResponse>;
}

/** Stops at the chooser without answering it. Kept for callers that must never select. */
export const unverifiedCompanySelector: CompanySelector = {
  async select() {
    throw new WovenTeamError(
      "company_selection_unverified",
      "Woven accepted the sign-in and asked which account to open, and Ask Sunny does not yet know how to answer that step.",
      { path: LOGIN_SUBMIT_PATH },
    );
  },
};

function normalizeCompany(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Whether a page is the post-authentication account chooser. */
export function isAccountChooser(html: string): boolean {
  const doc = parseHtmlDocument(html);
  if (COMPANY_CHOOSER_TEXT.test(textOf(doc))) return true;
  const title = elementsByTag(doc, "title")[0];
  return title ? COMPANY_CHOOSER_TITLE.test(title.childNodes?.map((c) => c.value ?? "").join("") ?? "") : false;
}

/** Whether a page is the credential form: it asks for a password. */
export function isCredentialForm(html: string): boolean {
  return elementsByTag(parseHtmlDocument(html), "input").some(
    (input) => attr(input, "name") === LOGIN_FIELDS.password || (attr(input, "type") ?? "").toLowerCase() === "password",
  );
}

type Element = ReturnType<typeof elementsByTag>[number];

function ancestors(el: Element): Element[] {
  const out: Element[] = [];
  for (let node = el.parentNode ?? null; node; node = node.parentNode ?? null) {
    if ((node as Element).tagName) out.push(node as Element);
  }
  return out;
}

/** The chooser entries whose own text is exactly the company name (deepest element per entry). */
function companyEntries(doc: ReturnType<typeof parseHtmlDocument>, company: string): Element[] {
  const want = normalizeCompany(company);
  const exact = [...walkAll(doc)].filter((el) => normalizeCompany(textOf(el)) === want);
  /* Keep the deepest: drop any element that has a matching descendant. */
  return exact.filter((el) => !exact.some((other) => other !== el && ancestors(other).includes(el)));
}

/** Every element in the page body, in document order. */
function* walkAll(root: ReturnType<typeof parseHtmlDocument>): Generator<Element> {
  const body = elementsByTag(root, "body")[0];
  if (body) yield* walkBody(body);
}

function* walkBody(root: Element): Generator<Element> {
  for (const child of root.childNodes ?? []) {
    if ((child as Element).tagName) {
      yield child as Element;
      yield* walkBody(child as Element);
    }
  }
}

const SAFE_NAME = /^[A-Za-z_$][\w$.]{0,63}$/;

/** What an entry's markup offers, and the evidence for the report when it offers nothing usable. */
export type ChooserAction =
  | { kind: "link"; href: string }
  | { kind: "form"; action: string; method: "GET" | "POST"; fields: Record<string, string> }
  | { kind: "unsupported"; evidence: string };

export function chooserAction(html: string, company: string): ChooserAction | { kind: "missing" } | { kind: "ambiguous"; count: number } {
  const doc = parseHtmlDocument(html);
  const entries = companyEntries(doc, company);
  if (entries.length === 0) return { kind: "missing" };
  if (entries.length > 1) return { kind: "ambiguous", count: entries.length };
  const entry = entries[0]!;
  const chain = [entry, ...ancestors(entry)];

  /* A plain link: the entry itself, or the link around it. */
  const link = chain.find((el) => el.tagName === "a");
  const href = link ? (attr(link, "href") ?? "").trim() : "";
  if (link && href && !href.startsWith("#") && !/^javascript:/i.test(href)) {
    return { kind: "link", href };
  }

  /* A form submit: the entry is (or is inside) a submit control of a form. */
  const control = chain.find(
    (el) => el.tagName === "button" || (el.tagName === "input" && ["submit", "image"].includes((attr(el, "type") ?? "").toLowerCase())),
  );
  const form = chain.find((el) => el.tagName === "form");
  const controlType = control ? (attr(control, "type") ?? "submit").toLowerCase() : "";
  if (control && form && controlType !== "button") {
    const fields: Record<string, string> = {};
    for (const input of elementsByTag(form, "input")) {
      const name = attr(input, "name");
      const type = (attr(input, "type") ?? "text").toLowerCase();
      if (!name || ["submit", "image", "button", "checkbox", "radio", "file", "password"].includes(type)) continue;
      fields[name] = attr(input, "value") ?? "";
    }
    const name = attr(control, "name");
    if (name) fields[name] = attr(control, "value") ?? "";
    const method = (attr(form, "method") ?? "get").toUpperCase() === "POST" ? "POST" : "GET";
    return { kind: "form", action: (attr(form, "action") ?? "").trim(), method, fields };
  }

  /* Nothing a browser would do without running the page's script. Report what is there. */
  const notes: string[] = [];
  for (const el of chain.slice(0, 5)) {
    for (const a of el.attrs ?? []) {
      if (/^on[a-z]+$/i.test(a.name)) {
        const fn = /^\s*(?:return\s+)?([A-Za-z_$][\w$.]*)\s*\(/.exec(a.value)?.[1];
        notes.push(`${el.tagName}[${a.name}${fn && SAFE_NAME.test(fn) ? `=${fn}(…)` : ""}]`);
      } else if (a.name.startsWith("data-")) {
        notes.push(`${el.tagName}[${a.name}]`);
      }
    }
  }
  return { kind: "unsupported", evidence: notes.length > 0 ? [...new Set(notes)].join(", ") : `${entry.tagName} with no link, form or handler` };
}

/**
 * The default selector: follows the configured company's chooser entry when it
 * is a same-origin link or a form submit; otherwise reports exactly what it saw.
 */
export const markupCompanySelector: CompanySelector = {
  async select(page, company, client) {
    const action = chooserAction(page.text, company);
    const base = new URL(page.path, "https://placeholder.invalid");
    switch (action.kind) {
      case "missing":
        throw new WovenTeamError("company_not_listed", `Woven accepted the sign-in, but ${company} is not one of the accounts it offers this login.`, {
          path: safePath(page.path),
        });
      case "ambiguous":
        throw new WovenTeamError(
          "company_selection_unverified",
          `Woven's account chooser lists ${company} ${action.count} times, so Ask Sunny did not pick one.`,
          { path: safePath(page.path) },
        );
      case "unsupported":
        throw new WovenTeamError(
          "company_selection_unverified",
          `Woven accepted the sign-in and showed the account chooser, but the ${company} entry is selected by the page's script (${action.evidence}), not a link or form. The request that script sends is needed.`,
          { path: safePath(page.path) },
        );
      case "link": {
        const target = new URL(action.href, base);
        return client.request("GET", target.pathname + target.search, null);
      }
      case "form": {
        const target = new URL(action.action || page.path, base);
        const path = target.pathname + target.search;
        if (action.method === "GET") {
          const query = new URLSearchParams(action.fields).toString();
          return client.request("GET", `${target.pathname}?${query}`, null);
        }
        return client.request("POST", path, { kind: "form", value: action.fields });
      }
    }
  },
};

export interface CompanyVerifier {
  /** The active company as the page shows it, or null when it cannot be confirmed. */
  activeCompany(page: PageResponse, expected: string): string | null;
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

/** Reads the login form: its hidden values and where it posts. Throws `login_page_changed` if it is not the documented form. */
export function readLoginForm(html: string): { fields: Record<string, string>; action: string } {
  const doc = parseHtmlDocument(html);
  const actionPath = (value: string) => new URL(value, "https://placeholder.invalid").pathname.toLowerCase();
  const form = elementsByTag(doc, "form").find((f) => actionPath(attr(f, "action") ?? "") === LOGIN_SUBMIT_PATH.toLowerCase());
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
  /* Post where the form posts (it may carry `?ReturnUrl=`), always on the Woven origin. */
  const target = new URL(attr(form, "action") ?? LOGIN_SUBMIT_PATH, "https://placeholder.invalid");
  return {
    fields: {
      [LOGIN_FIELDS.isLocationLogin]: hiddenInputValue(doc, LOGIN_FIELDS.isLocationLogin) ?? "",
      [LOGIN_FIELDS.setTermsSignedDate]: hiddenInputValue(doc, LOGIN_FIELDS.setTermsSignedDate) ?? "",
      [LOGIN_FIELDS.antiForgery]: token,
    },
    action: target.pathname + target.search,
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
  const form = readLoginForm(loginPage.text);

  let landing = await client.request("POST", form.action, {
    kind: "form",
    value: {
      [LOGIN_FIELDS.username]: options.credentials.username,
      [LOGIN_FIELDS.password]: options.credentials.password,
      ...form.fields,
    },
  });

  /* B before A: the chooser is served at /Login/Authenticate and may carry a form posting there. */
  if (landing.status < 400 && isAccountChooser(landing.text)) {
    landing = await (options.selector ?? markupCompanySelector).select(landing, options.company, client);
    if (isAccountChooser(landing.text)) {
      throw new WovenTeamError(
        "company_selection_unverified",
        `Ask Sunny chose ${options.company} on Woven's account chooser, but Woven showed the chooser again.`,
        { path: safePath(landing.path) },
      );
    }
    if (isCredentialForm(landing.text)) {
      throw new WovenTeamError(
        "company_selection_unverified",
        `Woven accepted the sign-in, but choosing ${options.company} returned to the sign-in page.`,
        { path: safePath(landing.path) },
      );
    }
  } else if (landing.status >= 400 || isCredentialForm(landing.text)) {
    throw new WovenTeamError(
      "login_failed",
      "Woven did not accept the integration account's sign-in. Check the Woven username and password.",
      { status: landing.status, path: LOGIN_SUBMIT_PATH },
    );
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
