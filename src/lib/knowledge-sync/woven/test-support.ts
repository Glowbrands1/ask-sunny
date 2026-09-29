/**
 * ============================================================================
 * A FAKE WOVEN TEAM — the handoff's redacted shapes, served over a fake fetch
 * ============================================================================
 *
 * Every response body here follows the shapes in the Woven Team handoff: the
 * login form's field names, the `/Policy` table's data attributes, inline
 * `mPolicyAttachments` and handbook `m*` variables, DataTables `{ list }` rows
 * with `EntityID` / `ColumnN`, `{ Success, HTML }` card lists, and the handbook
 * download envelope. Values are invented. Nothing reaches a network.
 *
 * It behaves like the real thing where the connector's safety depends on it:
 * unauthenticated reads redirect to `/Login`, sessions can be expired on
 * demand, temporary storage links carry SAS parameters and expire, and the
 * storage host records whether a Woven cookie was (wrongly) sent to it.
 */

export const COMPANY = "JB & Associates";
export const USERNAME = "ask-sunny-integration@example.test";
export const PASSWORD = "correct horse battery staple";

export interface FakeAttachment {
  documentId: string;
  name: string;
  size: number;
  contentType: string;
  bytes: string;
}

export interface FakePolicy {
  id: string;
  title: string;
  status: string;
  disabled?: boolean;
  audience: string;
  updated: string;
  attachments: FakeAttachment[];
}

export interface FakeHandbook {
  id: string;
  name: string;
  status: string;
  audience: string;
  updated: string;
  updatedOn: string;
  currentVersionId: string | null;
  draftVersionId: string | null;
  fileName: string;
  bytes: string;
}

export interface FakeProcedure {
  id: string;
  title: string;
  body: string;
}

export interface FakeRow {
  [column: string]: string;
}

export interface FakeWovenState {
  company: string;
  otherCompany: string | null;
  requireCompanySelection: boolean;
  policies: FakePolicy[];
  handbooks: FakeHandbook[];
  procedures: FakeProcedure[];
  fileLibrary: FakeRow[];
  knowledgeElements: FakeRow[];
  courses: FakeRow[];
}

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function defaultState(): FakeWovenState {
  return {
    company: COMPANY,
    otherCompany: null,
    requireCompanySelection: false,
    policies: [
      {
        id: uuid(101),
        title: "Attendance Policy",
        status: "current",
        audience: "Public",
        updated: "5/1/2025",
        attachments: [{ documentId: uuid(1101), name: "Attendance Policy.pdf", size: 12345, contentType: "application/pdf", bytes: "%PDF attendance v1" }],
      },
      {
        id: uuid(102),
        title: "Dress Code",
        status: "current",
        audience: "Public",
        updated: "4/2/2025",
        attachments: [],
      },
      {
        id: uuid(103),
        title: "Manager Bonus Policy",
        status: "current",
        audience: "Managers",
        updated: "3/3/2025",
        attachments: [{ documentId: uuid(1103), name: "Bonus.pdf", size: 222, contentType: "application/pdf", bytes: "%PDF bonus v1" }],
      },
    ],
    handbooks: [
      {
        id: uuid(201),
        name: "Team Member Handbook",
        status: "Published",
        audience: "Public",
        updated: "5/13/2026",
        updatedOn: "2026-05-13T14:02:11",
        currentVersionId: uuid(2101),
        draftVersionId: null,
        fileName: "Team Member Handbook.pdf",
        bytes: "%PDF handbook v1",
      },
      {
        id: uuid(202),
        name: "Draft Handbook",
        status: "Draft",
        audience: "Public",
        updated: "6/1/2026",
        updatedOn: "2026-06-01T09:00:00",
        currentVersionId: null,
        draftVersionId: uuid(2201),
        fileName: "Draft.pdf",
        bytes: "%PDF draft",
      },
    ],
    procedures: [
      { id: uuid(301), title: "Opening the Salon", body: "Step 1. Unlock. Step 2. Lights." },
      { id: uuid(302), title: "Bed Cleaning", body: "Step 1. Spray. Step 2. Wipe." },
    ],
    fileLibrary: [
      { EntityID: uuid(401), Column1: "PDF", Column2: '<a href="#">Lotion Guide</a>', Column3: "Published", Column4: "Public", Column5: "<span>1.2 MB</span>", Column6: "9/1/2026", Column7: "Sales", Column8: "Sun Tan City" },
      { EntityID: uuid(402), Column1: "Video", Column2: "<b>Welcome Video</b>", Column3: "Published", Column4: "Public", Column5: "40 MB", Column6: "8/1/2026", Column7: "", Column8: "JB & Associates" },
      { EntityID: uuid(403), Column1: "PDF", Column2: "Old Flyer", Column3: "Unpublished", Column4: "Public", Column5: "1 MB", Column6: "1/1/2024", Column7: "", Column8: "JB & Associates" },
    ],
    knowledgeElements: [
      { EntityID: uuid(501), Column1: "<span>Current</span>", Column2: `<a href="/KnowledgeElement/Details/${uuid(501)}">Spray Tan Basics</a>`, Column3: "v2", Column4: "Dynamic", Column5: "Not Provided", Column6: '<span class="hidden">2025-10-09</span><span>10/9/2025</span>' },
      { EntityID: uuid(502), Column1: "<span>Draft</span>", Column2: `<a href="/KnowledgeElement/Details/${uuid(502)}">New Element</a>`, Column3: "v1", Column4: "Dynamic", Column5: "Not Provided", Column6: '<span class="hidden">2025-10-10</span><span>10/10/2025</span>' },
    ],
    courses: [
      { EntityID: uuid(601), Column1: "<span>Current</span>", Column2: '<img src="x.png">', Column3: `<a href="/Course/Details/${uuid(601)}">Onboarding</a>`, Column4: "v3", Column5: "Not Provided", Column6: '<span class="hidden">2025-10-13</span><span>10/13/2025</span>' },
    ],
  };
}

/* ------------------------------------------------------------- markup -- */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(body: string, scripts = ""): string {
  return `<!DOCTYPE html><html><head><title>Woven</title><script>var mTracking = "t-${Math.random()}";</script></head><body><nav>Woven Team</nav><main>${body}</main>${scripts}<input type="hidden" name="__RequestVerificationToken" value="page-token-${Math.random().toString(36).slice(2)}"></body></html>`;
}

export function loginPageHtml(error = ""): string {
  return page(
    `<h1>Sign in</h1>${error ? `<p class="error">${error}</p>` : ""}
     <form method="post" action="/Login/Authenticate">
       <input type="text" name="AuthenticationRequestUser">
       <input type="password" name="AuthenticationRequestPass">
       <input type="hidden" name="IsLocationLogin" value="False">
       <input type="hidden" name="SetTermsSignedDate" value="">
       <input type="hidden" name="__RequestVerificationToken" value="login-token-123">
     </form>`,
  );
}

function policyTable(state: FakeWovenState): string {
  const rows = state.policies
    .map(
      (p) => `<tr data-policy-id="${p.id}" data-status="${p.status}" data-disabled="${p.disabled ? "true" : "false"}" data-ack="false" data-has-attachments="${p.attachments.length > 0}">
        <td><a href="/Policy/Details/${p.id}">${esc(p.title)}</a></td><td>${p.status === "current" ? "Published" : p.status}</td><td>${esc(p.audience)}</td><td>${p.updated}</td></tr>`,
    )
    .join("");
  return page(`<table id="policies"><thead><tr><th>Title</th><th>Status</th><th>Audience</th><th>Last Updated</th></tr></thead><tbody>${rows}</tbody></table>`);
}

/* ------------------------------------------------------------- server -- */

export interface FakeRequest {
  method: string;
  url: string;
  path: string;
  cookie: string | null;
  body: string;
  contentType: string | null;
}

export class FakeWoven {
  state: FakeWovenState;
  readonly log: FakeRequest[] = [];
  /** Paths (pathname) answered with this status instead. */
  readonly failures = new Map<string, number>();
  /** Paths answered with a login page (as a misbehaving session would). */
  readonly loginInstead = new Set<string>();
  /** Paths answered with a malformed body. */
  readonly malformed = new Set<string>();
  /** Expire the session after this many more authenticated requests. */
  expireSessionAfter: number | null = null;
  /** The next N storage downloads find their temporary link already expired. */
  expireNextLinks = 0;
  logins = 0;
  private session: string | null = null;
  private linkCounter = 0;
  private readonly liveLinks = new Map<string, { bytes: string; expired: boolean }>();

  constructor(state: FakeWovenState = defaultState()) {
    this.state = state;
  }

  get blobRequests(): FakeRequest[] {
    return this.log.filter((r) => r.url.includes("blob.core.windows.net"));
  }

  expireSession(): void {
    this.session = null;
  }

  private signedLink(container: string, name: string, bytes: string): string {
    this.linkCounter += 1;
    const url = `https://woven.blob.core.windows.net/${container}/${encodeURIComponent(name)}?sv=2024-01-01&spr=https&se=2026-09-29T14%3A30%3A00Z&sr=b&sp=r&sig=SECRET${this.linkCounter}`;
    this.liveLinks.set(url, { bytes, expired: false });
    return url;
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";
    this.log.push({
      method: init?.method ?? "GET",
      url: url.href,
      path: url.pathname,
      cookie: headers.get("cookie"),
      body,
      contentType: headers.get("content-type"),
    });

    if (url.hostname.endsWith("blob.core.windows.net")) {
      const link = this.liveLinks.get(url.href);
      if (link && this.expireNextLinks > 0) {
        this.expireNextLinks -= 1;
        link.expired = true;
      }
      if (!link || link.expired) return new Response("<Error><Code>AuthenticationFailed</Code></Error>", { status: 403 });
      return new Response(new TextEncoder().encode(link.bytes), { status: 200, headers: { "content-type": "application/pdf" } });
    }

    const html = (text: string, status = 200, extra: Record<string, string> = {}) =>
      new Response(text, { status, headers: { "content-type": "text/html; charset=utf-8", ...extra } });
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    const redirect = (to: string, cookie?: string) => {
      const h = new Headers({ location: to });
      if (cookie) h.append("set-cookie", cookie);
      return new Response(null, { status: 302, headers: h });
    };

    const path = url.pathname;
    const method = init?.method ?? "GET";

    if (path === "/Login" && method === "GET") {
      return html(loginPageHtml(), 200, { "set-cookie": "__RequestVerificationToken_Cookie=af1; path=/; HttpOnly" });
    }
    if (path === "/Login/Authenticate" && method === "POST") {
      const form = new URLSearchParams(body);
      const ok =
        form.get("AuthenticationRequestUser") === USERNAME &&
        form.get("AuthenticationRequestPass") === PASSWORD &&
        form.get("__RequestVerificationToken") === "login-token-123" &&
        form.has("IsLocationLogin") &&
        form.has("SetTermsSignedDate");
      if (!ok) return html(loginPageHtml("Invalid username or password."));
      this.logins += 1;
      this.session = `s${this.logins}`;
      return redirect(this.state.requireCompanySelection ? "/Login/SelectCompany" : "/Dashboard", `WovenSession=${this.session}; path=/; HttpOnly; Secure`);
    }

    const authed = this.session !== null && (headers.get("cookie") ?? "").includes(`WovenSession=${this.session}`);
    if (authed && this.expireSessionAfter !== null) {
      if (this.expireSessionAfter <= 0) {
        this.session = null;
        this.expireSessionAfter = null;
      } else this.expireSessionAfter -= 1;
    }
    if (!this.session || !(headers.get("cookie") ?? "").includes(`WovenSession=${this.session}`)) {
      return redirect(`/Login?ReturnUrl=${encodeURIComponent(path)}`);
    }

    if (this.failures.has(path)) return html("<h1>Error</h1>", this.failures.get(path));
    if (this.loginInstead.has(path)) return html(loginPageHtml());
    if (this.malformed.has(path)) return json({ unexpected: true });

    const s = this.state;
    if (path === "/Login/SelectCompany") return html(page(`<h1>Select Company</h1><ul><li>${esc(s.company)}</li><li>Other Co</li></ul>`));
    if (path === "/Dashboard") return html(page(`<header class="company">${esc(s.otherCompany ?? s.company)}</header><h1>Dashboard</h1>`));
    if (path === "/Policy") return html(policyTable(s));

    const policyDetail = /^\/Policy\/Details\/(.+)$/.exec(path);
    if (policyDetail) {
      const policy = s.policies.find((p) => p.id === policyDetail[1]);
      if (!policy) return html("Not found", 404);
      const attachments = policy.attachments.map((a) => ({
        DocumentID: a.documentId,
        DocumentName: a.name,
        SizeInBytes: a.size,
        AzureFileURL: this.signedLink("policy", a.name, a.bytes),
        ContentType: a.contentType,
      }));
      return html(page(`<h1>${esc(policy.title)}</h1><p>Policy body text.</p>`, `<script>\nvar mPolicyAttachments = ${JSON.stringify(attachments)};\nif (mPolicyAttachments == null) {}\n</script>`));
    }

    if (path === "/KnowledgeCenter/_Handbooks_List_ForDataTable" && method === "POST") {
      return json({ list: s.handbooks.map((h) => ({ EntityID: h.id, Column1: `<a href="#">${esc(h.name)}</a>`, Column2: h.status, Column3: h.audience, Column4: h.updated })) });
    }
    const manage = /^\/KnowledgeCenter\/Handbooks\/(.+)\/manage$/.exec(path);
    if (manage) {
      const h = s.handbooks.find((x) => x.id === manage[1]);
      if (!h) return html("Not found", 404);
      const q = (v: string | null) => (v === null ? "null" : `'${v}'`);
      return html(page(`<h1>${esc(h.name)}</h1>`, `<script>var mHandbookID = '${h.id}';\nvar mHandbookName = "${h.name}";\nvar mUpdatedOn = '${h.updatedOn}';\nvar mCurrentVersionID = ${q(h.currentVersionId)};\nvar mDraftVersionID = ${q(h.draftVersionId)};</script>`));
    }
    if (path === "/KnowledgeCenter/_Handbook_DownloadVersion" && method === "POST") {
      const form = new URLSearchParams(body);
      const h = s.handbooks.find((x) => x.id === form.get("pHandbookID") && x.currentVersionId === form.get("pHandbookVersionID"));
      if (!h) return json({ Success: false, Message: "Not found" });
      return json({ Success: true, Download: { DownloadURL: this.signedLink("handbook", h.fileName, h.bytes), FileName: h.fileName, Version: "1" } });
    }

    if (path === "/KnowledgeCenter/_Search_Procedures" && method === "POST") {
      return json({ Success: true, HTML: s.procedures.map((p) => `<div class="card" data-procedure-id="${p.id}"><h3>${esc(p.title)}</h3><span>Operations</span></div>`).join("") });
    }
    const proc = /^\/KnowledgeCenter\/Procedure\/(.+)$/.exec(path);
    if (proc) {
      const p = s.procedures.find((x) => x.id === proc[1]);
      if (!p) return html("Not found", 404);
      return html(page(`<h1>${esc(p.title)}</h1><section>${esc(p.body)}</section>`));
    }

    if (path === "/FileLibrary/_FileLibrary_Management_List_ForDataTable" && method === "POST") return json({ list: s.fileLibrary });
    if (path === "/KnowledgeElement/_KnowledgeElement_List_ForDataTable" && method === "POST") return json({ list: s.knowledgeElements });
    if (path === "/Course/_Course_List_ForDataTable" && method === "POST") return json({ list: s.courses });

    return html("Not found", 404);
  };
}

export const noSleep = async () => {};
