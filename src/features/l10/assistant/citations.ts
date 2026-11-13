// Copied from the Leadership Hub (src/lib/assistant/citations.ts); keep in step with it.
/** Pure helpers for rendering assistant messages: citations, tool labels, artifacts. */

export interface ReportCitation {
  source: string;
  href: string;
  /** What the tool returned, so the pill can show exactly what the assistant read. */
  data?: unknown;
  /** True when the tool read demo data rather than real figures. */
  sample: boolean;
}
export interface WebCitation {
  url: string;
  title: string;
  domain: string;
}
export interface Citations {
  reports: ReportCitation[];
  web: WebCitation[];
}

interface PartLike {
  type: string;
  toolName?: string;
  result?: unknown;
  url?: string;
  title?: string;
  sourceType?: string;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Only same-app relative links are allowed for report pills. */
export function isInternalHref(href: unknown): href is string {
  return typeof href === "string" && /^\/(?!\/)/.test(href);
}

export function collectCitations(parts: readonly PartLike[]): Citations {
  const reports = new Map<string, ReportCitation>();
  const web = new Map<string, WebCitation>();
  for (const p of parts) {
    if (p.type === "tool-call") {
      const r = p.result as { source?: unknown; href?: unknown; data?: unknown } | undefined;
      if (r && typeof r.source === "string" && isInternalHref(r.href)) {
        const note = (r.data as { note?: unknown } | undefined)?.note;
        reports.set(r.source, { source: r.source, href: r.href, data: r.data, sample: typeof note === "string" && /mock data/i.test(note) });
      }
      // web_search results carry urls too; show them as web sources when the model did not emit source parts.
      if (p.toolName === "web_search" && Array.isArray(p.result)) {
        for (const hit of p.result as { url?: string; title?: string | null }[]) {
          if (hit?.url && /^https?:\/\//.test(hit.url) && !web.has(hit.url)) web.set(hit.url, { url: hit.url, title: hit.title ?? domainOf(hit.url), domain: domainOf(hit.url) });
        }
      }
    } else if (p.type === "source" && p.sourceType === "url" && p.url && /^https?:\/\//.test(p.url)) {
      web.set(p.url, { url: p.url, title: p.title || domainOf(p.url), domain: domainOf(p.url) });
    }
  }
  return { reports: [...reports.values()], web: [...web.values()] };
}

/** "Looking at Salon Details…", "Searching the web…", "Reading example.com…" */
export function toolLabel(toolName: string, args: unknown, done: boolean): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const REPORT: Record<string, string> = {
    getMeeting: "the meeting",
    getMeetingRecaps: "past meetings",
    getSalonDetails: "Salon Details",
    getTracker: "the Quarterly Tracker",
  };

  if (toolName === "getSalonReports") {
    const which = a.report === "comp" ? "Comp Report" : a.report === "sales" ? "Sales Totals" : "Reporting";
    return done ? `Looked at ${which}` : `Looking at ${which}…`;
  }
  if (toolName === "draftNote") return done ? "Drafted a note" : "Drafting a note…";
  if (REPORT[toolName]) return done ? `Looked at ${REPORT[toolName]}` : `Looking at ${REPORT[toolName]}…`;
  // Anthropic's sandbox steps (it filters web results with code). Private to Anthropic: nothing there reaches the person.
  if (/code_execution|bash_code_execution|text_editor_code_execution/.test(toolName)) return done ? "Worked through the results" : "Working through the results…";
  if (toolName === "web_search") return done ? "Searched the web" : "Searching the web…";
  if (toolName === "web_fetch") {
    const host = typeof a.url === "string" ? domainOf(a.url) : "page";
    return done ? `Read ${host}` : `Reading ${host}…`;
  }
  return done ? "Done" : "Working…";
}

/** An answer is "document-like" when it is long (≥ 25 lines) or holds a big table. */
export const ARTIFACT_MIN_LINES = 25;
export function isArtifactWorthy(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length >= ARTIFACT_MIN_LINES) return true;
  const tableRows = lines.filter((l) => /^\s*\|.*\|\s*$/.test(l)).length;
  return tableRows >= 12;
}

export function artifactTitle(text: string): string {
  const h = text.match(/^#{1,3}\s+(.+)$/m)?.[1];
  const base = (h ?? text.split("\n").find((l) => l.trim()) ?? "Document").replace(/[#*_`|]/g, "").trim();
  return base.slice(0, 60) || "Document";
}

export function artifactFilename(title: string, ext: "md" | "doc" = "md"): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "document"}.${ext}`;
}

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A Word-openable document (.doc) from the HTML the document pane already rendered. No code runs; images were never rendered. */
export function wordDocument(title: string, bodyHtml: string): string {
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4}table{border-collapse:collapse}th,td{border:1px solid #999;padding:4px 8px;text-align:left}th{background:#f2efe6}</style></head><body>${bodyHtml}</body></html>`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return "less than a second";
  return seconds < 60 ? `${Math.round(seconds)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/* ── Source viewer: turns a tool result into something a person can read ── */

const ACRONYMS: Record<string, string> = { id: "ID", ppta: "PPTA", eft: "EFT", efts: "EFTs", otc: "OTC", uv: "UV", hvac: "HVAC", mtd: "MTD", ytd: "YTD", l10: "L10" };

/** "daysToNotice" → "Days to notice", "salon_code" → "Salon code". */
export function humanKey(key: string): string {
  if (/\s/.test(key)) return key; // already a label written for people (e.g. "Grand Total · Month to Date")
  const words = key.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().split(/\s+/);
  return words.map((w, i) => ACRONYMS[w.toLowerCase()] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toLowerCase())).join(" ");
}

/** A primitive shown as text; null/undefined/empty as an em dash. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US") : String(Number(v.toFixed(4)));
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) return v.map(cellText).join(", ");
  return JSON.stringify(v);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Flattens one level of nested objects into "Parent · child" columns so rows stay one line each. */
export function flattenRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (isPlainObject(v)) for (const [k2, v2] of Object.entries(v)) out[`${humanKey(k)} · ${humanKey(k2)}`] = v2;
    else out[humanKey(k)] = v;
  }
  return out;
}

/** Column order: first-seen across all rows. */
export function tableColumns(rows: Record<string, unknown>[]): string[] {
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return cols;
}
