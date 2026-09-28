import Link from "next/link";
import { ArrowLeft, Clock, ShieldCheck } from "lucide-react";

import { Badge, StatusDot, type BadgeTone } from "@/components/ui/badge";
import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, SectionHeader } from "@/components/ui/layout";
import type { WovenSyncPageProps } from "./load";

/**
 * ============================================================================
 * WOVEN EMPLOYEE SYNC — where the integration stands, read from this deployment
 * ============================================================================
 *
 * The integration is built on Ask Sunny's side and waiting on Woven to approve
 * the Operations API subscription. This screen says exactly that, and no more:
 * the "built" stages describe code that ships in this build, and every other
 * stage is MEASURED — credentials present, tables created, schedule on — so the
 * screen changes by itself as each step is completed.
 *
 * NOTHING HERE IS SAMPLE DATA. No employee, count or run is shown until a real
 * sync has produced one.
 */

type StageState = "built" | "waiting" | "ready" | "next" | "done";

const STATE_LABEL: Record<StageState, string> = {
  built: "Built and tested",
  waiting: "Waiting on Woven",
  ready: "Ready",
  next: "Next step",
  done: "Complete",
};

const STATE_TONE: Record<StageState, BadgeTone> = {
  built: "ready",
  waiting: "attention",
  ready: "ready",
  next: "neutral",
  done: "ready",
};

interface Stage {
  title: string;
  detail: string;
  state: StageState;
}

const KEPT = [
  "Woven employee ID",
  "First, last and preferred name",
  "Work email",
  "Active or terminated",
  "Hire date",
  "Termination date",
  "Position",
  "Primary salon",
  "Other salons they work at",
  "Borrowed salons, with end date",
];

const NEVER_KEPT = [
  "Pay and compensation",
  "Date of birth",
  "Personal phone and email",
  "Home address",
  "Emergency contacts",
  "I-9 and background checks",
  "Notes and secure documents",
  "Banking and payroll",
  "Leave and medical",
];

const TRACKED = [
  "New hires",
  "Terminations",
  "Rehires",
  "Position changes",
  "Transfers between salons",
  "Salons added or removed",
  "Work email changes",
];

const RUN_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function when(value: string | null): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "—" : RUN_TIME.format(new Date(parsed));
}

export function stagesFor(props: WovenSyncPageProps): Stage[] {
  const credentialsReady = props.missingCredentials.length === 0;
  const databaseReady = props.database.state === "ready";
  const hasSucceeded = props.database.state === "ready" && props.database.status.lastSuccessAt !== null;

  return [
    {
      title: "Secure connection to Woven",
      detail:
        "Signs in to the Woven Operations API, reads every page of employees, stays under Woven's rate limit and retries safely. Read-only: Ask Sunny never changes anything in Woven.",
      state: "built",
    },
    {
      title: "Employee data filter",
      detail:
        "Keeps only the fields listed below. Pay, personal and HR records are discarded before anything is stored.",
      state: "built",
    },
    {
      title: "Change tracking",
      detail:
        "Compares each sync with the last one and records hires, terminations, rehires, position changes, transfers and salon changes in a permanent history.",
      state: "built",
    },
    {
      title: "Salon matching",
      detail:
        "Each Woven location is matched to its Ask Sunny salon by an administrator. Nothing is matched by guesswork.",
      state: "built",
    },
    {
      title: "Safety checks",
      detail:
        "A partial, failed or suspiciously small read from Woven is refused and nothing is saved, so the directory always reflects the last good sync. Nobody is ever deleted.",
      state: "built",
    },
    {
      title: "Woven API access",
      detail: credentialsReady
        ? "Woven credentials are configured for this deployment."
        : "Woven is reviewing the “Ask Sunny employee sync” subscription. Once approved, the credentials are added here and the first live check runs.",
      state: credentialsReady ? "ready" : "waiting",
    },
    {
      title: "Employee directory",
      detail: databaseReady
        ? "The employee directory and its change history are set up."
        : "The directory tables are prepared and are created after the first live check with Woven.",
      state: databaseReady ? "ready" : "next",
    },
    {
      title: "First sync",
      detail: hasSucceeded
        ? "Ask Sunny has completed a sync from Woven."
        : "A preview run first, then the first real sync, reviewed before anything is scheduled.",
      state: hasSucceeded ? "done" : "next",
    },
    {
      title: "Daily sync",
      detail: props.scheduleEnabled
        ? "Ask Sunny syncs from Woven automatically each day."
        : "Turned on after the first sync has been reviewed.",
      state: props.scheduleEnabled ? "done" : "next",
    },
  ];
}

function Chips({ items, tone }: { items: string[]; tone: BadgeTone }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item}>
          <Badge tone={tone} size="md">
            {item}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function WovenSyncScreen(props: WovenSyncPageProps) {
  const stages = stagesFor(props);
  const waitingOnWoven = props.missingCredentials.length > 0;
  const status = props.database.state === "ready" ? props.database.status : null;

  return (
    <PageShell>
      <Link
        href="/admin/integrations"
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Integrations
      </Link>

      <PageHeader
        eyebrow="Admin · Integrations"
        title="Woven Employee Sync"
        description="Keeps Ask Sunny's employee directory in step with Woven: who works where, in what position, and what changed."
      />

      {waitingOnWoven ? (
        <Notice tone="attention" icon={<Clock />} title="Waiting on Woven" className="mb-6">
          Everything on Ask Sunny&apos;s side is built and tested. The one remaining dependency is
          Woven approving the Operations API subscription and issuing credentials.
        </Notice>
      ) : (
        <Notice tone="accent" icon={<ShieldCheck />} title="Woven access is configured" className="mb-6">
          The next steps are a preview run, the first real sync, and a review before the daily
          sync is turned on.
        </Notice>
      )}

      <SectionHeader title="Progress" />
      <ol className="mb-8 flex flex-col divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
        {stages.map((stage) => (
          <li key={stage.title} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-foreground">{stage.title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{stage.detail}</p>
            </div>
            <Badge tone={STATE_TONE[stage.state]} size="sm" className="shrink-0 self-start">
              <StatusDot />
              {STATE_LABEL[stage.state]}
            </Badge>
          </li>
        ))}
      </ol>

      {status ? (
        <>
          <SectionHeader title="Sync status" />
          <dl className="mb-8 grid gap-3 sm:grid-cols-3">
            {[
              ["Last successful sync", when(status.lastSuccessAt)],
              ["Salons to match", String(status.unmappedLocations)],
              ["Changes to review", String(status.unreviewedChanges)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2.5">
                <dt className="text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">{label}</dt>
                <dd className="mt-1 text-[19px] leading-none font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <section>
          <SectionHeader title="What Ask Sunny keeps" description="The only employee fields copied from Woven." />
          <Chips items={KEPT} tone="ready" />
        </section>
        <section>
          <SectionHeader title="Never copied" description="Left in Woven, and never stored by Ask Sunny." />
          <Chips items={NEVER_KEPT} tone="neutral" />
        </section>
      </div>

      <section className="mb-8">
        <SectionHeader title="Changes it tracks" description="Each one is recorded with before and after, and kept permanently." />
        <Chips items={TRACKED} tone="outline" />
      </section>

      <Notice tone="neutral" icon={<ShieldCheck />} title="Access stays exactly as it is">
        The sync records what Woven says. It does not change anyone&apos;s Ask Sunny role or salon
        access, does not turn off a login when someone is terminated, and does not label a position
        change as a promotion. Each of those needs a separate decision before it is switched on.
      </Notice>
    </PageShell>
  );
}
