// Copied from the Leadership Hub (src/app/meetings/[key]/report/page.tsx); keep in step with it. See src/features/l10/README.md.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Card, PageHeader } from "@/features/l10/ui/ui";

/** Joins class names. (ui.tsx's cx is a client function, which a server component cannot call.) */
const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");
import { PrintButton } from "@/features/l10/meeting/_components/PrintButton";
import { readDoc } from "@/features/l10/lib/doc";
import type { CellTone } from "@/features/l10/lib/doc";
import { hasReference, isMeetingKey } from "@/features/l10/lib/config";
import { listRecaps, openMeeting } from "@/features/l10/data.server";
import { L10Frame } from "@/features/l10/L10Frame";
import { requireAuthenticatedPage } from "@/lib/auth/page";
import {
  LOOK_LABEL,
  QKEYS,
  STATUS_LABEL,
  defaultQuarter,
  defaultYear,
  fmtDate,
  fmtLike,
  glideRow,
  glideYears,
  latestQ,
  paceOf,
  pctOf,
  readTrackerV2,
  rockTrend,
  type Status as TStatus,
  type TrackerV2,
} from "@/features/l10/lib/tracker/v2";
import { businessDate as businessDateForReport } from "@/features/l10/lib/dueStatus";
import { COMPETENCIES, COMPETENCY_LABEL, type Competency } from "@/features/l10/lib/tracker/tracker";
import type { Vto } from "@/features/l10/lib/types";
import {
  NOT_TRACKED,
  NO_DATA,
  companyPageHasData,
  contents,
  trackerGoals,
  goalsSection,
  hasCompanyPages,
  issuesSection,
  metricsSection,
  planSection,
  quarterLabel,
  recapsSection,
  reportDate,
  seatTree,
  type RockLine,
  type SeatNode,
  type StatusWord,
} from "@/features/l10/lib/report";
import "@/features/l10/meeting/report.css";

export const metadata: Metadata = { title: "Meeting report" };

const COMPANY = "JB & Associates";

export const dynamic = "force-dynamic";

/** One meeting's report (Export PDF): only that meeting's data, for people who may open that meeting. */
export default async function ReportPage({ params }: { params: Promise<{ key: string }> }) {
  await requireAuthenticatedPage();
  const { key } = await params;
  if (!isMeetingKey(key)) notFound();
  // Ask Sunny: the Hub decides (allowlist + this person's meeting role), before anything renders; refused is not found.
  const mine = await openMeeting(key);
  if (!mine.ok && mine.reason === "forbidden") notFound();
  return (
    <L10Frame meetingKey={key} assistant={false}>
      <Suspense fallback={<p className="m-0 text-sm text-muted">Loading the report…</p>}>
        <Report meetingKey={key} mine={mine} />
      </Suspense>
    </L10Frame>
  );
}

const STATUS: Record<StatusWord, string> = {
  Done: "border border-[#1b5e2a] bg-[#e1f1e4] text-[#154a21]",
  "On track": "bg-ok text-ink",
  "Off track": "bg-warn text-warn-ink",
  "Not started": "bg-cream text-muted ring-1 ring-line",
};
const TONE: Record<CellTone, string> = {
  empty: "text-muted",
  negative: "font-semibold text-red-700",
  bad: "font-semibold text-red-700",
  near: "text-ink",
  good: "font-semibold text-green-700",
};
const MARK: Record<CellTone, string> = { empty: "", negative: "✗", bad: "✗", near: "", good: "✓" };

function Chip({ status }: { status: StatusWord }) {
  return <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap", STATUS[status])}>{status}</span>;
}

/** One printed page: a header band (section title, company, subtitle), then the section. */
function Sheet({ id, title, subtitle, children }: { id: string; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="report-sheet glass flex flex-col gap-4 p-6">
      <header className="report-band flex flex-wrap items-end justify-between gap-2 border-b border-line/60 pb-3">
        <div>
          <h2 id={`${id}-title`} className="m-0 text-[26px] leading-tight font-bold tracking-tight">
            {title}
          </h2>
          <p className="m-0 text-sm text-muted">{subtitle}</p>
        </div>
        <span className="text-sm font-semibold text-bronze-deep">{COMPANY}</span>
      </header>
      {children}
    </section>
  );
}

function Box({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("report-box overflow-hidden rounded-2xl border border-line/60 bg-white/70", className)}>
      <h3 className="m-0 bg-cream px-4 py-2 text-sm font-bold">{title}</h3>
      <div className="px-4 py-3 text-sm">{children}</div>
    </div>
  );
}

const Empty = () => <p className="m-0 text-sm text-muted" data-testid="report-empty">{NO_DATA}</p>;

function RockRow({ r }: { r: RockLine }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/50 py-2 first:border-t-0">
      <span className="min-w-[200px] flex-1 font-semibold">{r.title}</span>
      {r.due && <span className="text-xs text-muted">Due {r.due}</span>}
      {r.milestones && <span className="text-xs text-muted">{r.milestones}</span>}
      <Chip status={r.status} />
    </li>
  );
}

function SeatBox({ seat }: { seat: SeatNode }) {
  return (
    <li className="report-seat">
      <div className={cx("rounded-2xl bg-white/80 px-3 py-2.5 ring-1 ring-line/60", seat.open && "border-2 border-dashed border-line bg-transparent ring-0")}>
        <div className="flex items-center gap-2">
          <span aria-hidden className={cx("inline-flex size-8 flex-none items-center justify-center rounded-full text-xs font-bold", seat.open ? "bg-cream text-muted" : "bg-ink text-gold-head")}>
            {seat.open ? "?" : seat.initials}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold">{seat.title || "Seat"}</span>
            <span className="block text-xs text-muted">{seat.open ? "Open" : seat.name}</span>
          </span>
        </div>
        {seat.responsibilities.length > 0 && (
          <ul className="m-0 mt-1.5 list-disc pl-5 text-xs">
            {seat.responsibilities.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </div>
      {seat.children.length > 0 && (
        <ul className="report-seat-children m-0 list-none p-0">
          {seat.children.map((c) => (
            <SeatBox key={c.id} seat={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

async function Report({ meetingKey: key, mine }: { meetingKey: string; mine: Awaited<ReturnType<typeof openMeeting>> }) {
  if (!mine.ok) {
    return (
      <>
        <PageHeader eyebrow="L10 MEETINGS" title="Quarterly report" />
        <Card>
          <p className="m-0 text-sm">
            {mine.reason === "not-configured" ? "Sign in to see the report. It loads from the Leadership Hub database, which is not connected in this environment." : "The report could not be loaded just now. Please try again in a minute."}
          </p>
        </Card>
      </>
    );
  }
  // Same rule as the meeting page: the database only lists meetings this person may open; anything else is not found.
  const meeting = mine.meeting.info;
  const roster = mine.meeting.roster;
  // Only this meeting's recaps (listRecaps filters by key; the extra filter keeps it so if that ever changes).
  const [loaded, recapsResult] = [{ ok: true as const, loaded: mine.meeting.loaded }, await listRecaps(key)];
  const recaps = recapsResult.ok ? recapsResult.recaps.filter((r) => r.meeting_key === key) : [];
  if (!loaded.ok) {
    return (
      <Card>
        <p className="m-0 text-sm">The report could not be loaded just now. Please try again in a minute.</p>
      </Card>
    );
  }
  const doc = readDoc(loaded.loaded.doc);
  const now = new Date();
  const date = reportDate(now);
  const subtitle = `${COMPANY}, ${meeting.name} · ${date}`;
  // The company pages (Leadership only) come from the Quarterly Tracker; anything it cannot give stays a placeholder.
  // Ask Sunny opens no meeting with company pages (the tracker stays in the Hub), so there is no tracker to read.
  const tracker = readTrackerV2(null);
  const today = businessDateForReport();
  const trackerQuarter = defaultQuarter(tracker, today);
  // Leadership: the Goals page shows the tracker's rocks for the current quarter when there are any.
  const fromTracker = hasCompanyPages(key) ? trackerGoals(tracker, trackerQuarter) : null;
  const goals = fromTracker ?? goalsSection(doc.rocks);
  const plan = planSection(doc.vto, doc.rocks);
  const seats = seatTree(doc.seats);
  const issues = issuesSection(doc.issues, recaps, roster);
  const metrics = metricsSection(doc);
  const recapLines = recapsSection(recaps);
  const pct = goals.total ? Math.round((goals.done / goals.total) * 100) : 0;

  return (
    <div className="report flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <div className="text-xs font-bold tracking-[0.12em] text-bronze-deep">L10 MEETINGS</div>
          <h1 className="m-0 mt-1 text-[28px] leading-tight font-bold tracking-tight">Quarterly report</h1>
          <p className="m-0 text-sm text-muted">{`Built from the ${meeting.name} as it is saved now, and nothing else. Export PDF prints it landscape, one section per page.`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintButton />
          <Link href={`/meetings/${key}`} className="inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-bronze-deep hover:underline">
            {`← ${meeting.name}`}
          </Link>
        </div>
      </header>

      {/* Cover */}
      <section aria-labelledby="cover-title" className="report-sheet report-cover glass flex flex-col gap-6 p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="m-0 text-sm font-semibold text-bronze-deep">{COMPANY}</p>
            <h2 id="cover-title" className="m-0 mt-1 text-[44px] leading-none font-bold tracking-tight">
              Quarterly Report
            </h2>
            <p className="m-0 mt-2 text-lg">{`${quarterLabel(now)} Review · ${COMPANY} ${meeting.name} · ${date}`}</p>
          </div>
          <span aria-hidden className="inline-flex size-20 items-center justify-center rounded-full border-4 border-gold text-2xl font-extrabold tracking-tight">
            JBA
          </span>
        </div>
        <nav aria-label="Contents" className="self-end">
          <h3 className="m-0 mb-1 text-sm font-bold">Contents</h3>
          <ol className="m-0 grid list-decimal grid-cols-1 gap-x-8 gap-y-0.5 pl-5 text-sm sm:grid-cols-2">
            {contents(key).map((c) => (
              <li key={c.id}>
                <a href={`#${c.id}`} className="hover:underline">
                  {c.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </section>

      <Sheet id="goals" title="Goals" subtitle={subtitle}>
        <p className="m-0 text-sm font-semibold" data-testid="rocks-done">
          {fromTracker
            ? `Quarterly Rocks, ${tracker.quarters.find((q) => q.id === trackerQuarter)?.label || trackerQuarter}: ${fromTracker.done} of ${fromTracker.total} done (${fromTracker.pct}%)`
            : `Quarterly Rocks: ${goals.total ? `${goals.done} of ${goals.total} individual rocks done (${pct}%)` : "no individual rocks yet"}`}
        </p>
        <Box title="Company Rocks">{goals.company.length ? <ul className="m-0 list-none p-0">{goals.company.map((r) => <RockRow key={r.id} r={r} />)}</ul> : <Empty />}</Box>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {goals.people.map((p) => (
            <Box key={p.name} title={p.name}>
              <div className="mb-1 flex items-center gap-2">
                <span aria-hidden className="inline-flex size-8 items-center justify-center rounded-full bg-sunny text-xs font-bold">
                  {p.initials}
                </span>
                <span className="text-xs text-muted">
                  {p.rocks.filter((r) => r.status === "Done").length} of {p.rocks.length} done
                </span>
              </div>
              <ul className="m-0 list-none p-0">
                {p.rocks.map((r) => (
                  <RockRow key={r.id} r={r} />
                ))}
              </ul>
            </Box>
          ))}
        </div>
      </Sheet>

      {/* The STC DM L10 has no Reference views, so its report has no Business Plan or org chart (lib/config.ts hasReference). */}
      {hasReference(key) && (
        <>
      <Sheet id="business-plan" title="Business Plan" subtitle={subtitle}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Box title="Core Values">
            {plan.coreValues.length ? (
              <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5">
                {plan.coreValues.map((c, i) => (
                  <li key={i}>
                    <b>{c.name}</b>
                    {c.desc && <span className="text-muted">: {c.desc}</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <Empty />
            )}
          </Box>
          <Box title="Core Focus">
            <p className="m-0">
              <b>Purpose: </b>
              {plan.purpose || <span className="text-muted">{NO_DATA}</span>}
            </p>
            <p className="m-0 mt-1.5">
              <b>Niche: </b>
              {plan.niche || <span className="text-muted">{NO_DATA}</span>}
            </p>
          </Box>
          <Box title="10-Year Target">{plan.tenYear ? <p className="m-0">{plan.tenYear}</p> : <Empty />}</Box>
          <Box title="Marketing Strategy">{plan.marketing ? <p className="m-0 whitespace-pre-line">{plan.marketing}</p> : <Empty />}</Box>
          <Box title="3-Year Picture">{plan.threeYear.length ? <ul className="m-0 list-disc pl-5">{plan.threeYear.map((t, i) => <li key={i}>{t}</li>)}</ul> : <Empty />}</Box>
          <Box title="1-Year Goals">{plan.oneYear.length ? <ol className="m-0 list-decimal pl-5">{plan.oneYear.map((t, i) => <li key={i}>{t}</li>)}</ol> : <Empty />}</Box>
          <Box title="Quarterly Goals (Company Rocks)" className="md:col-span-2">
            {plan.quarterly.length ? <ul className="m-0 list-none p-0">{plan.quarterly.map((r) => <RockRow key={r.id} r={r} />)}</ul> : <Empty />}
          </Box>
        </div>
      </Sheet>

      <Sheet id="org-chart" title="Organizational Chart" subtitle={subtitle}>
        {seats.length ? (
          <ul className="report-seats m-0 list-none p-0" aria-label="Accountability chart">
            {seats.map((s) => (
              <SeatBox key={s.id} seat={s} />
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </Sheet>

        </>
      )}
      <Sheet id="issues" title="Issues" subtitle={subtitle}>
        <p className="m-0 text-sm" data-testid="issues-note">
          {`Open on the IDS list as of ${date}: ${issues.open} ${issues.open === 1 ? "issue" : "issues"}.`}
          {issues.solvedLast !== null && ` ${issues.solvedLast} ${issues.solvedLast === 1 ? "issue was" : "issues were"} solved at the last L10.`}
        </p>
        {issues.groups.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {issues.groups.map((g) => (
              <Box key={g.person} title={g.person}>
                <ol className="m-0 list-decimal pl-5">
                  {g.titles.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ol>
              </Box>
            ))}
          </div>
        ) : (
          <Empty />
        )}
        <p className="m-0 text-xs text-muted">Short-term and long-term issues are not split in the Hub yet; all open issues are listed by who added them.</p>
      </Sheet>

      <Sheet id="metrics" title="Metrics" subtitle={subtitle}>
        {metrics.owners.length ? (
          metrics.owners.map((o, i) => (
            <div key={o.owner} className="report-metrics flex flex-col gap-2">
              {/* Each owner after the first prints on its own page: repeat the section's header band there (print only). */}
              {i > 0 && (
                <div aria-hidden data-testid="report-continued" className="report-band report-continued mb-2 hidden flex-wrap items-end justify-between gap-2 border-b border-line/60 pb-3 print:flex">
                  <div>
                    <div className="text-[26px] leading-tight font-bold tracking-tight">Metrics (continued)</div>
                    <p className="m-0 text-sm text-muted">{subtitle}</p>
                  </div>
                  <span className="text-sm font-semibold text-bronze-deep">{COMPANY}</span>
                </div>
              )}
              <h3 className="m-0 text-base font-bold">{o.owner}</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-separate border-spacing-0 text-xs" aria-label={`Scorecard: ${o.owner}`}>
                  <thead>
                    <tr className="bg-ink/90 text-gold-head">
                      <th scope="col" className="px-2 py-2 text-left font-semibold">Measurable</th>
                      {metrics.weeks.map((w) => (
                        <th key={w} scope="col" className="px-1.5 py-2 text-right font-mono font-semibold tabular-nums">
                          {w}
                        </th>
                      ))}
                      <th scope="col" className="px-2 py-2 text-right font-semibold">Goal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.rows.map((r, i) => (
                      <tr key={i} className="odd:bg-white/50">
                        <th scope="row" className="border-t border-line/50 px-2 py-1.5 text-left font-semibold">
                          {r.metric}
                        </th>
                        {r.cells.map((c, j) => (
                          <td key={j} className={cx("border-t border-line/50 px-1.5 py-1.5 text-right font-mono whitespace-nowrap tabular-nums", TONE[c.tone])}>
                            {c.text} {MARK[c.tone] && <span aria-label={c.tone === "good" ? "on goal" : "off goal"}>{MARK[c.tone]}</span>}
                          </td>
                        ))}
                        <td className="border-t border-line/50 px-2 py-1.5 text-right font-mono whitespace-nowrap">{r.goal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        ) : (
          <Empty />
        )}
      </Sheet>

      <Sheet id="recaps" title="Meeting Recaps" subtitle={subtitle}>
        {recapLines.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm" aria-label={`${meeting.name} recaps`}>
              <thead>
                <tr className="bg-ink/90 text-gold-head">
                  <th scope="col" className="px-2 py-2 text-left font-semibold">Held</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Length</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Rating</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Issues solved</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Open to-dos</th>
                  <th scope="col" className="px-2 py-2 text-left font-semibold">Cascading message</th>
                </tr>
              </thead>
              <tbody>
                {recapLines.map((r) => (
                  <tr key={r.id} className="odd:bg-white/50" data-testid="report-recap">
                    <th scope="row" className="border-t border-line/50 px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                      {r.held}
                      {r.autoSaved && <span className="ml-1.5 rounded-full bg-warn px-2 py-0.5 text-[11px] font-bold text-warn-ink">Auto-saved</span>}
                    </th>
                    <td className="border-t border-line/50 px-2 py-1.5 text-right font-mono tabular-nums">{r.duration}</td>
                    <td className="border-t border-line/50 px-2 py-1.5 text-right font-mono tabular-nums">{r.rating}</td>
                    <td className="border-t border-line/50 px-2 py-1.5 text-right font-mono tabular-nums">{r.solved}</td>
                    <td className="border-t border-line/50 px-2 py-1.5 text-right font-mono tabular-nums">{r.openTodos}</td>
                    <td className="border-t border-line/50 px-2 py-1.5">{r.cascade || <span className="text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty />
        )}
      </Sheet>

      {hasCompanyPages(key) && NOT_TRACKED.map((t) => (
        <Sheet key={t.id} id={t.id} title={t.title} subtitle={subtitle}>
          {companyPageHasData(t.id, tracker, doc.vto) ? (
            <CompanyPage id={t.id} tracker={tracker} vto={doc.vto} today={today} />
          ) : (
            <div className="report-placeholder rounded-2xl border-2 border-dashed border-line px-5 py-6" data-testid="report-placeholder">
              <p className="m-0 text-base font-bold">{NO_DATA}</p>
              <p className="m-0 mt-1 text-sm text-muted">This page of the quarterly report needs: {t.what}.</p>
            </div>
          )}
        </Sheet>
      ))}
    </div>
  );
}

/* ── Company pages from the Quarterly Tracker (Leadership report) ───────── */

const TH = "px-2 py-2 font-semibold";
const TD = "border-t border-line/50 px-2 py-1.5";
const NUM = "text-right font-mono whitespace-nowrap tabular-nums";
const T_STATUS: Record<TStatus, StatusWord> = { done: "Done", on: "On track", off: "Off track", hold: "Not started" };
const CHIP_TONE = { ok: "bg-ok text-ink", warn: "bg-warn text-warn-ink", muted: "bg-cream text-muted ring-1 ring-line", done: STATUS.Done } as const;

function Chiplet({ tone, children }: { tone: keyof typeof CHIP_TONE; children: ReactNode }) {
  return <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap", CHIP_TONE[tone])}>{children}</span>;
}

function PctBar({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  return (
    <span aria-hidden className="mt-1 block h-1.5 w-full max-w-36 overflow-hidden rounded-full bg-line/60">
      <span className={cx("block h-full rounded-full", pct >= 100 ? "bg-[#1b5e2a]" : "bg-gold")} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

function CompanyPage({ id, tracker, vto, today }: { id: string; tracker: TrackerV2; vto: Vto; today: string }) {
  switch (id) {
    case "quarterly-tracker":
      return <QuarterlyTrackerPage t={tracker} today={today} />;
    case "annual-goals":
      return <AnnualGoalsPage t={tracker} today={today} />;
    case "three-year-glide":
      return <GlidePage t={tracker} today={today} />;
    case "team-health":
      return <TeamHealthPage t={tracker} />;
    case "long-term-issues":
      return <LongTermIssuesPage t={tracker} />;
    case "people-seats":
      return <PeoplePage t={tracker} />;
    case "marketing-by-brand":
      return <MarketingPage vto={vto} />;
    default:
      return null;
  }
}

/** Rock completion by quarter (stat tiles) and the current quarter's rocks by owner. */
function QuarterlyTrackerPage({ t, today }: { t: TrackerV2; today: string }) {
  const trend = rockTrend(t).slice(0, 6).reverse();
  const q = defaultQuarter(t, today);
  const rows = t.rocks.filter((r) => r.quarter === q);
  const owners = [...new Set(rows.map((r) => (r.company ? "Company" : r.owner || "Not assigned")))];
  return (
    <div className="flex flex-col gap-4" data-testid="report-quarterly-tracker">
      <div className="report-box">
        <h3 className="m-0 mb-2 text-base font-bold">Rock completion by quarter</h3>
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-6">
          {trend.map((x) => (
            <li key={x.quarter.id} className={cx("rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-line/60", x.quarter.id === q && "ring-2 ring-gold")} data-testid="report-trend-tile">
              <div className="text-xs font-semibold text-muted">{x.quarter.label}</div>
              <div className="text-2xl font-bold tabular-nums">{x.n ? `${x.pct}%` : "—"}</div>
              <div className="text-xs text-muted">{`${x.d} of ${x.n} done`}</div>
            </li>
          ))}
        </ul>
      </div>
      <div className="report-box">
        <h3 className="m-0 mb-2 text-base font-bold">{`${t.quarters.find((x) => x.id === q)?.label || q}: rocks by owner`}</h3>
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
          {owners.map((o) => (
            <div key={o}>
              <div className="text-xs font-bold tracking-wide text-muted uppercase">{o}</div>
              <ul className="m-0 list-none p-0">
                {rows
                  .filter((r) => (r.company ? "Company" : r.owner || "Not assigned") === o)
                  .map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 border-t border-line/40 py-1 text-xs first:border-t-0">
                      <span>{r.title}</span>
                      <Chip status={T_STATUS[r.status]} />
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The year's measurables by quarter (% of goal and computed pace) and the annual goals with their check-ins. */
function AnnualGoalsPage({ t, today }: { t: TrackerV2; today: string }) {
  const year = defaultYear(t, today);
  const y = t.years.find((x) => x.year === year);
  const goals = t.goals.filter((g) => g.year === year).sort((a, b) => (a.num ?? 99) - (b.num ?? 99));
  const curN = t.settings.currentQuarter.startsWith(`${year}-Q`) ? t.settings.currentQuarter.slice(6) : "";
  return (
    <div className="flex flex-col gap-4" data-testid="report-annual-goals">
      <div className="report-box">
        <h3 className="m-0 mb-2 text-base font-bold">{`${year} measurables by quarter`}</h3>
        {y?.measurables.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-xs" aria-label={`${year} measurables by quarter`}>
              <thead>
                <tr className="bg-ink/90 text-gold-head">
                  <th scope="col" className={cx(TH, "text-left")}>Measurable</th>
                  <th scope="col" className={cx(TH, "text-right")}>Baseline</th>
                  {QKEYS.map((k) => (
                    <th key={k} scope="col" className={cx(TH, "text-right", k === curN && "underline decoration-2 underline-offset-4")}>
                      {`Q${k}`}
                    </th>
                  ))}
                  <th scope="col" className={cx(TH, "text-right")}>Goal</th>
                  <th scope="col" className={cx(TH, "text-right")}>% of goal</th>
                  <th scope="col" className={cx(TH, "text-left")}>Pace</th>
                </tr>
              </thead>
              <tbody>
                {y.measurables.map((m) => {
                  const l = latestQ(m);
                  const p = l ? pctOf(l.v, m.target) : null;
                  const pace = paceOf(m);
                  return (
                    <tr key={m.id} className="odd:bg-white/50">
                      <th scope="row" className={cx(TD, "text-left font-semibold")}>
                        {m.label}
                        {m.goal !== null && <span className="ml-1 text-[10px] font-bold text-bronze-deep">{`Goal ${m.goal}`}</span>}
                        <PctBar pct={p} />
                      </th>
                      <td className={cx(TD, NUM)}>{m.baseline || "—"}</td>
                      {QKEYS.map((k) => (
                        <td key={k} className={cx(TD, NUM)}>
                          {m.q[k] || "—"}
                        </td>
                      ))}
                      <td className={cx(TD, NUM, "font-bold")}>{m.target || "—"}</td>
                      <td className={cx(TD, NUM, p !== null && p >= 100 && "font-bold text-[#1b5e2a]")}>{p === null ? "—" : `${p}%`}</td>
                      <td className={TD}>{pace ? <Chiplet tone={pace.status === "behind" ? "warn" : "ok"}>{pace.label}</Chiplet> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="m-0 mt-1 text-[10px] text-muted">Pace is worked out by the Hub: progress to the goal against the share of the year passed at the latest quarter.</p>
          </div>
        ) : (
          <Empty />
        )}
      </div>
      <div className="report-box">
        <h3 className="m-0 mb-2 text-base font-bold">{`Goals for ${year}`}</h3>
        {goals.length ? (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {goals.map((g) => (
              <li key={g.id} className="border-t border-line/40 pt-2 first:border-t-0 first:pt-0">
                <div className="flex items-start justify-between gap-2 text-sm">
                  <span>
                    <b className="mr-1.5 text-bronze-deep">{g.num ?? "•"}.</b>
                    <b>{g.text}</b>
                    {g.owner && <span className="text-muted">{` · ${g.owner}`}</span>}
                  </span>
                  <Chip status={T_STATUS[g.status]} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                  {QKEYS.map((k) => {
                    const c = g.checkins[`${year}-Q${k}`];
                    return c ? (
                      <span key={k}>
                        <b>{`Q${k}`}</b> {STATUS_LABEL[c.status]}
                        {c.note && <span className="text-muted">{` · ${c.note}`}</span>}
                      </span>
                    ) : null;
                  })}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Empty />
        )}
      </div>
    </div>
  );
}

/** The 3-year glide path (the tracker app's rule) and "What does it look like?". */
function GlidePage({ t, today }: { t: TrackerV2; today: string }) {
  const ty = t.plan.threeyear;
  const currentYear = t.settings.year ?? Number(today.slice(0, 4));
  const { years } = glideYears(ty.futureDate, currentYear);
  const LOOK_TONE = { hold: "muted", on: "ok", done: "done" } as const;
  return (
    <div className="flex flex-col gap-4" data-testid="report-glide">
      {(ty.revenue || ty.futureDate) && (
        <p className="m-0 text-base">
          {ty.revenue && <b>{ty.revenue}</b>}
          {ty.futureDate && <span className="text-muted">{` by ${ty.futureDate}`}</span>}
        </p>
      )}
      {ty.measurables.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-xs" aria-label="3-year glide path">
            <thead>
              <tr className="bg-ink/90 text-gold-head">
                <th scope="col" className={cx(TH, "text-left")}>Measurable</th>
                <th scope="col" className={cx(TH, "text-right")}>Baseline</th>
                {years.map((y) => (
                  <th key={y} scope="col" className={cx(TH, "text-right")}>
                    {y}
                  </th>
                ))}
                <th scope="col" className={cx(TH, "text-right")}>Latest</th>
                <th scope="col" className={cx(TH, "text-left")}>Where we are</th>
              </tr>
            </thead>
            <tbody>
              {ty.measurables.map((m) => {
                const g = glideRow(m, ty.futureDate, currentYear);
                return (
                  <tr key={m.id} className="odd:bg-white/50">
                    <th scope="row" className={cx(TD, "text-left font-semibold")}>
                      {m.label}
                    </th>
                    <td className={cx(TD, NUM)}>{m.baseline || "—"}</td>
                    {years.map((y) => {
                      const w = g.waypoints.find((x) => x.year === y);
                      return (
                        <td key={y} className={cx(TD, NUM, y === currentYear && "font-bold")}>
                          {w ? fmtLike(w.value, m.target) : "—"}
                        </td>
                      );
                    })}
                    <td className={cx(TD, NUM)}>
                      {m.actual || "—"}
                      {m.asOf && <span className="block text-[10px] text-muted">{fmtDate(m.asOf)}</span>}
                    </td>
                    <td className={TD}>{g.verdict ? <Chiplet tone={g.kind === "behind" ? "warn" : g.kind === "ytd" ? "muted" : "ok"}>{g.verdict}</Chiplet> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {ty.looksLike.length > 0 && (
        <div className="report-box">
          <h3 className="m-0 mb-2 text-base font-bold">What does it look like?</h3>
          <ul className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-1 p-0 md:grid-cols-2">
            {ty.looksLike.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-2 border-t border-line/40 py-1 text-xs">
                <span>{l.text}</span>
                <Chiplet tone={LOOK_TONE[l.status]}>{LOOK_LABEL[l.status]}</Chiplet>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The latest pulse: overall, the five competencies, every behaviour (lowest first), and the trend. */
function TeamHealthPage({ t }: { t: TrackerV2 }) {
  const pulses = [...t.teamhealth].sort((a, b) => b.date.localeCompare(a.date));
  const p = pulses[0];
  const behaviours = [...p.behaviors].sort((a, b) => (a.n ?? 99) - (b.n ?? 99));
  return (
    <div className="flex flex-col gap-3" data-testid="report-team-health">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="m-0 text-base font-bold">{`Pulse ${p.date ? fmtDate(p.date) : ""}`}</h3>
        <div className="text-right">
          <div className="text-[11px] font-bold tracking-wide text-muted uppercase">Overall</div>
          <div className="text-3xl font-bold" data-testid="report-health-overall">{p.overall === null ? "—" : `${p.overall}%`}</div>
        </div>
      </div>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-5">
        {COMPETENCIES.map((c) => (
          <li key={c} className="rounded-xl bg-white/70 px-2 py-1.5 text-center ring-1 ring-line/60">
            <div className="text-[11px] font-semibold text-muted">{COMPETENCY_LABEL[c]}</div>
            <div className="font-mono text-lg font-bold">{p.pcts[c] !== null ? `${p.pcts[c]}%` : (p.scores[c] ?? "—")}</div>
          </li>
        ))}
      </ul>
      {behaviours.length > 0 && (
        <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[11px]" aria-label="Behaviours">
          <thead>
            <tr className="bg-ink/90 text-gold-head">
              <th scope="col" className={cx(TH, "text-right")}>No.</th>
              <th scope="col" className={cx(TH, "text-left")}>Behaviour</th>
              <th scope="col" className={cx(TH, "text-left")}>Competency</th>
              <th scope="col" className={cx(TH, "text-left")}>Owners</th>
              <th scope="col" className={cx(TH, "text-right")}>Score</th>
            </tr>
          </thead>
          <tbody>
            {behaviours.map((b) => (
              <tr key={b.id} className="odd:bg-white/50">
                <td className={cx(TD, NUM, "py-1")}>{b.n ?? ""}</td>
                <th scope="row" className={cx(TD, "py-1 text-left font-semibold")}>
                  {b.text}
                </th>
                <td className={cx(TD, "py-1")}>{COMPETENCY_LABEL[b.comp as Competency] ?? b.comp}</td>
                <td className={cx(TD, "py-1")}>{b.owners}</td>
                <td className={cx(TD, NUM, "py-1 font-bold")}>{b.score ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {pulses.length > 1 && (
        <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-xs" aria-label="Trend across pulses">
          <thead>
            <tr className="bg-ink/90 text-gold-head">
              <th scope="col" className={cx(TH, "text-left")}>Pulse</th>
              <th scope="col" className={cx(TH, "text-right")}>Overall</th>
              {COMPETENCIES.map((c) => (
                <th key={c} scope="col" className={cx(TH, "text-right")}>
                  {COMPETENCY_LABEL[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...pulses].reverse().map((x) => (
              <tr key={x.id} className="odd:bg-white/50">
                <th scope="row" className={cx(TD, "text-left font-semibold")}>
                  {x.date ? fmtDate(x.date) : "—"}
                </th>
                <td className={cx(TD, NUM, "font-bold")}>{x.overall === null ? "—" : `${x.overall}%`}</td>
                {COMPETENCIES.map((c) => (
                  <td key={c} className={cx(TD, NUM)}>
                    {x.pcts[c] !== null ? `${x.pcts[c]}%` : (x.scores[c] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {p.notes && <p className="m-0 text-xs whitespace-pre-line">{p.notes}</p>}
    </div>
  );
}

function LongTermIssuesPage({ t }: { t: TrackerV2 }) {
  const open = t.issues.filter((i) => i.status === "open");
  const closed = t.issues.filter((i) => i.status === "closed");
  const list = (items: typeof t.issues) => (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {items.map((x) => (
        <li key={x.id} className="border-t border-line/40 pt-1.5 text-sm first:border-t-0 first:pt-0">
          <b>{x.text}</b>
          <span className="block text-xs text-muted">{[x.owner, x.quarter, x.added && `added ${fmtDate(x.added)}`].filter(Boolean).join(" · ")}</span>
          {x.notes && <span className="block text-xs">{x.notes}</span>}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="report-long-term-issues">
      <Box title={`Open (${open.length})`}>{open.length ? list(open) : <p className="m-0 text-muted">None.</p>}</Box>
      <Box title={`Closed (${closed.length})`}>{closed.length ? list(closed) : <p className="m-0 text-muted">None.</p>}</Box>
    </div>
  );
}

function PeoplePage({ t }: { t: TrackerV2 }) {
  const ref = t.plan.reference;
  return (
    <div className="flex flex-col gap-2" data-testid="report-people">
      {(ref.peopleDate || ref.peopleNote) && <p className="m-0 text-xs text-muted">{[ref.peopleDate && `Assessed ${fmtDate(ref.peopleDate)}`, ref.peopleNote].filter(Boolean).join(" · ")}</p>}
      <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-xs" aria-label="Key people">
        <thead>
          <tr className="bg-ink/90 text-gold-head">
            <th scope="col" className={cx(TH, "text-left")}>Person</th>
            <th scope="col" className={cx(TH, "text-right")}>Core values</th>
            <th scope="col" className={cx(TH, "text-right")}>Performance</th>
            <th scope="col" className={cx(TH, "text-right")}>Potential</th>
            <th scope="col" className={cx(TH, "text-right")}>Role alignment</th>
            <th scope="col" className={cx(TH, "text-left")}>Note</th>
          </tr>
        </thead>
        <tbody>
          {ref.people.map((p) => (
            <tr key={p.id} className="odd:bg-white/50">
              <th scope="row" className={cx(TD, "text-left font-semibold")}>
                {p.name}
              </th>
              <td className={cx(TD, NUM)}>{p.cv ?? "—"}</td>
              <td className={cx(TD, NUM)}>{p.perf ?? "—"}</td>
              <td className={cx(TD, NUM)}>{p.pot ?? "—"}</td>
              <td className={cx(TD, NUM)}>{p.ra ?? "—"}</td>
              <td className={TD}>{p.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function MarketingPage({ vto }: { vto: Vto }) {
  const brands = (vto.brands ?? []).filter((b) => b.brand.trim());
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="report-marketing">
      {brands.map((b) => (
        <Box key={b.id} title={b.brand}>
          <dl className="m-0 flex flex-col gap-2 text-sm">
            <div>
              <dt className="text-[11px] font-bold tracking-wide text-muted uppercase">Who we&apos;re for</dt>
              <dd className="m-0 whitespace-pre-line">{b.target || "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold tracking-wide text-muted uppercase">Why us</dt>
              <dd className="m-0">
                <ol className="m-0 list-decimal pl-5">
                  {b.differentiators.filter(Boolean).map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ol>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold tracking-wide text-muted uppercase">Proven process</dt>
              <dd className="m-0 whitespace-pre-line">{b.process || "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold tracking-wide text-muted uppercase">Our guarantee</dt>
              <dd className="m-0 whitespace-pre-line">{b.guarantee || "—"}</dd>
            </div>
          </dl>
        </Box>
      ))}
    </div>
  );
}

