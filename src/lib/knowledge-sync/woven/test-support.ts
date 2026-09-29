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
  /** The read-only body text; null renders a page without the verified body structure. */
  body: string | null;
  version: string;
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
  steps: { id: string; text: string }[];
  attachments: { documentId: string; stepIndex: number; fileName: string }[];
  /** Render the page without the verified step structure. */
  legacyLayout?: boolean;
}

export interface FakeKnowledgeElementPage {
  pageId: string;
  title: string;
  /** Rendered as `.content[content-id]` blocks; `null` renders a different content type. */
  blocks: { id: string; html: string }[] | null;
}

export interface FakeRow {
  [column: string]: string;
}

export interface FakeWovenState {
  company: string;
  otherCompany: string | null;
  requireCompanySelection: boolean;
  /**
   * How the chooser's entries select an account. The LIVE mechanism is not yet
   * captured, so all three are exercised; the routes behind "link" and "form"
   * are fixtures for the mechanism, not claims about Woven's routes.
   */
  chooserMechanism: "script" | "link" | "form";
  /** Accounts the chooser lists (live: JB & Associates, Midwest Soap Makers). */
  chooserAccounts: { id: string; name: string }[];
  /** Show the verified "Add Profile Photo" interstitial after sign-in (and after choosing, if any). */
  photoPrompt: boolean;
  /** Deliberately broken photo pages / answers, for the failure tests. */
  photoVariant: "ok" | "missing_field" | "no_token" | "returns_login" | "wrong_company";
  policies: FakePolicy[];
  handbooks: FakeHandbook[];
  procedures: FakeProcedure[];
  fileLibrary: FakeRow[];
  knowledgeElements: FakeRow[];
  /** Content pages per Knowledge Element id. */
  knowledgeElementPages: Record<string, FakeKnowledgeElementPage[]>;
  courses: FakeRow[];
  /** Also carry attachments in the inline `mPolicyAttachments` variable (older page shape). */
  policyAttachmentsVar: boolean;
}

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function defaultState(): FakeWovenState {
  return {
    company: COMPANY,
    otherCompany: null,
    requireCompanySelection: false,
    chooserMechanism: "script",
    photoPrompt: false,
    photoVariant: "ok",
    chooserAccounts: [
      { id: uuid(9001), name: COMPANY },
      { id: uuid(9002), name: "Midwest Soap Makers" },
    ],
    policies: [
      {
        id: uuid(101),
        title: "Attendance Policy",
        status: "current",
        audience: "Public",
        updated: "5/1/2025",
        body: "Arrive on time.\nCall the salon if you will be late.",
        version: "Version 2",
        attachments: [{ documentId: uuid(1101), name: "Attendance Policy.pdf", size: 12345, contentType: "application/pdf", bytes: "%PDF attendance v1" }],
      },
      {
        id: uuid(102),
        title: "Dress Code",
        status: "current",
        audience: "Public",
        updated: "4/2/2025",
        body: "Wear the Sun Tan City uniform.",
        version: "Version 1",
        attachments: [],
      },
      {
        id: uuid(103),
        title: "Manager Bonus Policy",
        status: "current",
        audience: "All Teams 8 Positions",
        updated: "3/3/2025",
        body: "Bonus rules for managers.",
        version: "Version 3",
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
      {
        id: uuid(301),
        title: "Opening the Salon",
        steps: [
          { id: uuid(3011), text: "Unlock the front door." },
          { id: uuid(3012), text: "Turn on the lights." },
        ],
        attachments: [{ documentId: uuid(3111), stepIndex: 1, fileName: "Opening Checklist.pdf" }],
      },
      { id: uuid(302), title: "Bed Cleaning", steps: [{ id: uuid(3021), text: "Spray and wipe every surface." }], attachments: [] },
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
    knowledgeElementPages: {
      [uuid(501)]: [
        {
          pageId: uuid(5011),
          title: "Spray Tan Basics",
          blocks: [
            {
              id: uuid(50111),
              html: '<p>Prepare the booth.</p><p>Watch the <a href="https://example.sharepoint.com/sites/training/video.mp4">booth video</a>.</p>',
            },
          ],
        },
      ],
    },
    policyAttachmentsVar: false,
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

/** The verified "Add Profile Photo" interstitial, served at /Login/Authenticate. */
export function profilePhotoHtml(state: FakeWovenState, companyId: string): string {
  const field = (name: string, value: string) =>
    (state.photoVariant === "missing_field" && name === "EmployeeID") || (state.photoVariant === "no_token" && name === "__RequestVerificationToken")
      ? ""
      : `<input type="hidden" name="${name}" value="${esc(value)}">`;
  return `<!DOCTYPE html><html><head><title>Add Profile Photo</title></head><body><main>
    <h2>Add Profile Photo</h2>
    <form id="add-profile-image-form" method="post" action="/Login/Authenticate" enctype="application/x-www-form-urlencoded">
      ${field("AuthenticationRequestUser", USERNAME)}
      ${field("AuthenticationRequestPass", PASSWORD)}
      ${field("EmployeeID", uuid(7001))}
      ${field("CompanyID", companyId)}
      <input type="hidden" id="SkipAddEmployeeProfileImage" name="SkipAddEmployeeProfileImage" value="false">
      ${field("__RequestVerificationToken", "photo-token")}
      <input type="file" name="ProfileImage" accept="image/*">
      <button type="submit" class="btn btn-primary">Save Photo</button>
    </form>
    <a href="#" onclick="blur(); ReturnToLogin(); return false;">Ask me later</a>
    <a href="#" onclick="blur(); DontAskAgain(); return false;">Don't ask me again</a>
  </main><script>function ReturnToLogin(){ $('#SkipAddEmployeeProfileImage').val(true); $('#add-profile-image-form').submit(); }</script></body></html>`;
}

/** The verified live chooser: served at /Login/Authenticate, heading "Select account for login". */
export function accountChooserHtml(state: FakeWovenState): string {
  const entry = (a: { id: string; name: string }) => {
    switch (state.chooserMechanism) {
      case "link":
        return `<a href="/Login/SelectAccount?pCompanyID=${a.id}">${esc(a.name)}</a>`;
      case "form":
        return `<button type="submit" class="btn-link" name="SelectedCompanyID" value="${a.id}">${esc(a.name)}</button>`;
      case "script":
        return `<a href="javascript:void(0)" data-company-id="${a.id}" onclick="SelectAccount('${a.id}')">${esc(a.name)}</a>`;
    }
  };
  const rows = state.chooserAccounts.map((a) => `<tr><td><img src="/logo/${a.id}.png" alt=""></td><td>${entry(a)}</td></tr>`).join("");
  const table = `<input type="search" placeholder="Search..."><table class="table"><thead><tr><th></th><th>Account</th></tr></thead><tbody>${rows}</tbody></table>`;
  const body =
    state.chooserMechanism === "form"
      ? `<form method="post" action="/Login/Authenticate?ReturnUrl=%2F"><input type="hidden" name="__RequestVerificationToken" value="chooser-token">${table}</form>`
      : table;
  return `<!DOCTYPE html><html><head><title>Select Company</title></head><body><main><img src="/woven.svg" alt="woven"><p>Select account for login</p>${body}</main><footer>Copyright © 2026 Woven</footer></body></html>`;
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

/** The verified account dropdown, carrying the ACTIVE company. */
function accountMenu(company: string): string {
  return `<ul class="nav navbar-nav navbar-right"><li class="dropdown"><a href="#" class="dropdown-toggle" data-toggle="dropdown">Ask Sunny Integration<br><small>${esc(company)}</small></a></li></ul>`;
}

/** Verified headers: Policy, Status, Audience, Last Updated, Acknowledgement, plus an unlabeled document column. */
function policyTable(state: FakeWovenState): string {
  const rows = state.policies
    .map(
      (p) => `<tr data-policy-id="${p.id}" data-status="${p.status}" data-disabled="${p.disabled ? "true" : "false"}" data-ack="false" data-has-attachments="${p.attachments.length > 0}">
        <td><a href="/Policy/Details/${p.id}">${esc(p.title)}</a></td><td>${p.status === "current" ? "Published" : p.status}</td><td><span>${esc(p.audience)}</span></td><td>${p.updated}</td><td>0%</td><td>${p.attachments.length > 0 ? '<i class="fa fa-file"></i>' : ""}</td></tr>`,
    )
    .join("");
  return page(`${accountMenu(state.company)}<table id="policies"><thead><tr><th>Policy</th><th>Status</th><th>Audience</th><th>Last Updated</th><th>Acknowledgement</th><th></th></tr></thead><tbody>${rows}</tbody></table>`);
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
  /** The account chosen on the chooser this session, if any. */
  chosenCompany: string | null = null;
  photoSkipped = false;
  photoSubmissions = 0;
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
    const sessionCookie = this.session !== null && (headers.get("cookie") ?? "").includes(`WovenSession=${this.session}`);
    const afterSignIn = (companyId: string) =>
      this.state.photoPrompt && !this.photoSkipped ? html(profilePhotoHtml(this.state, companyId)) : redirect("/");
    const choose = (id: string | null) => {
      const account = this.state.chooserAccounts.find((a) => a.id === id);
      if (!account) return html(accountChooserHtml(this.state));
      this.chosenCompany = account.name;
      return afterSignIn(account.id);
    };
    /* "Ask me later": the photo form, re-posted with SkipAddEmployeeProfileImage=true. */
    if (path === "/Login/Authenticate" && method === "POST" && sessionCookie && new URLSearchParams(body).has("SkipAddEmployeeProfileImage")) {
      const form = new URLSearchParams(body);
      this.photoSubmissions += 1;
      if (form.get("__RequestVerificationToken") !== "photo-token" || form.get("SkipAddEmployeeProfileImage") !== "true") return html("Bad Request", 400);
      if (this.state.photoVariant === "returns_login") return html(loginPageHtml());
      if (this.state.photoVariant === "wrong_company") this.chosenCompany = "Midwest Soap Makers";
      this.photoSkipped = true;
      return redirect("/");
    }
    if (path === "/Login/SelectAccount" && method === "GET" && sessionCookie) return choose(url.searchParams.get("pCompanyID"));
    if (path === "/Login/Authenticate" && method === "POST" && sessionCookie && new URLSearchParams(body).has("SelectedCompanyID")) {
      const form = new URLSearchParams(body);
      if (form.get("__RequestVerificationToken") !== "chooser-token") return html("Bad Request", 400);
      return choose(form.get("SelectedCompanyID"));
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
      this.chosenCompany = null;
      this.photoSkipped = false;
      const cookie = `WovenSession=${this.session}; path=/; HttpOnly; Secure`;
      /* Live: the chooser is the 200 answer to the POST itself, at /Login/Authenticate?ReturnUrl=%2F. */
      if (this.state.requireCompanySelection) return html(accountChooserHtml(this.state), 200, { "set-cookie": cookie });
      if (this.state.photoPrompt) return html(profilePhotoHtml(this.state, uuid(9001)), 200, { "set-cookie": cookie });
      return redirect("/Dashboard", cookie);
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
    /* The switcher lists JB & Associates either way; only the account dropdown says which is ACTIVE. */
    if (path === "/Dashboard" || path === "/") {
      return html(page(`${accountMenu(s.otherCompany ?? this.chosenCompany ?? s.company)}<ul class="company-switcher"><li>${esc(s.company)}</li><li>Other Co</li></ul><h1>Dashboard</h1>`));
    }
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
      const records = attachments
        .map(
          (a) => `<div class="wo-preview" data-document-id="${a.DocumentID}"><span class="wo-preview__name">${esc(a.DocumentName)}</span>
            <a href="javascript:void(0)" onclick="DownloadDocumentFromDashboard('${a.AzureFileURL}', '${esc(a.DocumentName)}', '${a.ContentType}')">Download</a></div>`,
        )
        .join("");
      const body =
        policy.body === null
          ? `<div id="policy-editor-column"><textarea name="ContentHTML"></textarea></div>`
          : `<div id="policy-editor-column"><div class="form-group"><label for="ContentHTML">Policy</label><div class="read-only-label">${policy.body
              .split("\n")
              .map((line) => `<p>${esc(line)}</p>`)
              .join("")}</div></div></div>`;
      const script = s.policyAttachmentsVar
        ? `<script>\nvar mPolicyAttachments = ${JSON.stringify(attachments)};\nif (mPolicyAttachments == null) {}\n</script>`
        : "";
      return html(
        page(
          `${accountMenu(s.company)}<h1>${esc(policy.title)}</h1><span class="badge">${policy.status === "current" ? "Published" : esc(policy.status)}</span>
           <div class="dropdown"><button class="btn dropdown-toggle">${esc(policy.version)}</button></div>${body}<div id="policy-attachments">${records}</div>`,
          script,
        ),
      );
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
    const procManage = /^\/KnowledgeCenter\/Procedure\/([^/]+)\/Management$/.exec(path);
    if (procManage) {
      const p = s.procedures.find((x) => x.id === procManage[1]);
      if (!p) return html("Not found", 404);
      const steps = p.steps
        .map(
          (step, i) => `<div class="step" data-procedure-step-id="${step.id}"><h4>Step ${i + 1}</h4>${p.attachments
            .filter((a) => a.stepIndex === i)
            .map((a) => `<div class="attachment" data-attachment-id="${a.documentId}"><span>${esc(a.fileName)}</span></div>`)
            .join("")}</div>`,
        )
        .join("");
      return html(page(`${accountMenu(s.company)}<h1>${esc(p.title)}</h1><span class="badge">Published</span>${steps}`));
    }
    const proc = /^\/KnowledgeCenter\/Procedure\/([^/]+)$/.exec(path);
    if (proc) {
      const p = s.procedures.find((x) => x.id === proc[1]);
      if (!p) return html("Not found", 404);
      if (p.legacyLayout) return html(page(`<h1>${esc(p.title)}</h1><section>${p.steps.map((st) => esc(st.text)).join(" ")}</section>`));
      const steps = p.steps
        .map(
          (step, i) => `<div class="procedure-step-container" data-procedure-step-id="${step.id}"><div id="procedure-step-content"><p>${esc(step.text)}</p></div>
            <ul class="procedure-step-attachment-list">${p.attachments
              .filter((a) => a.stepIndex === i)
              .map((a) => `<li><a onclick="DownloadProcedureStepAttachment('${esc(a.fileName)}')">${esc(a.fileName)}</a></li>`)
              .join("")}</ul></div>`,
        )
        .join("");
      return html(page(`${accountMenu(s.company)}<h1>${esc(p.title)}</h1>${steps}`));
    }

    const keContent = /^\/KnowledgeElement\/Details\/([^/]+)\/Content\/([^/]+)$/.exec(path);
    if (keContent) {
      const pg = (s.knowledgeElementPages[keContent[1]!] ?? []).find((x) => x.pageId === keContent[2]);
      if (!pg) return html("Not found", 404);
      const blocks =
        pg.blocks === null
          ? `<div class="quiz-builder" data-quiz-id="q1">Quiz</div>`
          : pg.blocks.map((b) => `<div class="content" content-id="${b.id}">${b.html}</div>`).join("");
      return html(page(`${accountMenu(s.company)}<input id="Name" name="Name" value="${esc(pg.title)}">${blocks}`));
    }
    const keDetails = /^\/KnowledgeElement\/Details\/([^/]+)$/.exec(path);
    if (keDetails) {
      const pages = s.knowledgeElementPages[keDetails[1]!] ?? [];
      const links = pages.map((pg) => `<li><a href="/KnowledgeElement/Details/${keDetails[1]}/Content/${pg.pageId}">${esc(pg.title)}</a></li>`).join("");
      return html(page(`${accountMenu(s.company)}<h1>Element</h1><span class="badge">Current</span><ul class="content-pages">${links}</ul>`));
    }

    if (path === "/FileLibrary/_FileLibrary_Management_List_ForDataTable" && method === "POST") return json({ list: s.fileLibrary });
    if (path === "/KnowledgeElement/_KnowledgeElement_List_ForDataTable" && method === "POST") return json({ list: s.knowledgeElements });
    if (path === "/Course/_Course_List_ForDataTable" && method === "POST") return json({ list: s.courses });

    return html("Not found", 404);
  };
}

export const noSleep = async () => {};
