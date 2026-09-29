import { ArrowRight, ShieldCheck } from "lucide-react";

import { Badge, StatusDot, type BadgeTone } from "@/components/ui/badge";
import { Notice } from "@/components/ui/feedback";
import { PageShell, SectionHeader } from "@/components/ui/layout";
import type { WovenSyncPageProps } from "./load";
import { SummaryCards } from "./summary-cards";
import { WovenHeader } from "./tabs";
import { SyncPanel } from "./sync-panel";
import { ValidationPanel } from "./validation-panel";

/**
 * ============================================================================
 * WOVEN EMPLOYEE SYNC — where the integration stands, read from this deployment
 * ============================================================================
 *
 * TWO LISTS, KEPT APART. "Built" is code that ships in this build. "Go-live
 * steps" are facts about this deployment, and each is MEASURED or EVIDENCED:
 *
 *   Subscription      reported active in the Woven portal; CONFIRMED only when
 *                     a recorded run proves Ask Sunny signed in
 *   Credentials       which server-side variables are set (names, never values)
 *   Sign-in           evidence from a recorded run, or the live check below
 *   Response check    reviewed from the live check's report; a successful sync
 *                     is the recorded evidence
 *   Directory         the database's answer — "not created" only when the
 *                     table is genuinely missing
 *   First sync        a succeeded run
 *   Daily sync        cron entry deployed in this build AND switch on AND a
 *                     scheduled run that succeeded. A switch alone is not a
 *                     schedule.
 *
 * THE CARDS ARE COUNTS ONLY, so this tab needs Manage integrations and no
 * more. In a DEMO build the cards show the labelled sample set under a
 * "Sample data" banner; the go-live steps are always this deployment's own.
 */

type StepState = "done" | "reported" | "pending" | "attention" | "not_started";

const STATE_TONE: Record<StepState, BadgeTone> = {
  done: "ready",
  reported: "processing",
  pending: "neutral",
  attention: "attention",
  not_started: "outline",
};

export interface Step {
  key: string;
  title: string;
  detail: string;
  state: StepState;
  label: string;
}

const BUILT = [
  ["Secure connection to Woven", "Signs in, reads every page, stays under Woven's rate limit, retries safely. Read-only: it can reach only the four read endpoints and the sign-in, never a Woven write."],
  ["Employee data filter", "Keeps only the fields listed below and discards everything else before anything is stored."],
  ["Change tracking", "Compares each sync with the last and keeps a permanent history of hires, terminations, rehires, position changes, transfers and location access."],
  ["Salon and position matching", "An administrator matches each Woven location to its Ask Sunny salon, and each Woven position to a role and rank. Nothing is matched by guesswork, and nothing is applied to anyone's access."],
  ["Safety checks", "A partial, failed or suspiciously small read is refused and nothing is saved. Nobody is ever deleted."],
  ["Test Woven connection", "A read-only validation with its own switch: checks the real Woven responses against what Ask Sunny expects and Woven's locations against the salons, reporting counts and field names only. It never runs a sync."],
] as const;

const NEVER_KEPT = [
  "Pay and compensation",
  "Date of birth",
  "Cell and home phone",
  "Termination reason",
  "Rehire eligibility",
  "Gender, ethnicity, marital status",
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
  "Location access added or removed",
  "Email changes",
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

/**
 * When "Test Woven connection" may be pressed. In demo mode it also needs the
 * sync switch OFF and an access code set — the server enforces both again.
 */
export function validationAvailable(props: WovenSyncPageProps): boolean {
  if (!props.validationEnabled || props.missingCredentials.length > 0) return false;
  return props.liveMode || (!props.enabled && props.validationAccessCodeConfigured);
}

export function validationUnavailableReason(props: WovenSyncPageProps): string | null {
  if (props.missingCredentials.length > 0) return "Add the Woven credentials to this deployment first.";
  if (!props.validationEnabled) {
    return "Turn on WOVEN_VALIDATION_ENABLED for this deployment first. It opens this read-only test only, never a sync.";
  }
  if (!props.liveMode && props.enabled) {
    return "This deployment runs in demo mode, where the connection test runs only while WOVEN_SYNC_ENABLED is off.";
  }
  if (!props.liveMode && !props.validationAccessCodeConfigured) {
    return "This deployment runs in demo mode, where the connection test also needs WOVEN_VALIDATION_ACCESS_CODE set (at least 16 characters).";
  }
  return null;
}

export function stepsFor(props: WovenSyncPageProps): Step[] {
  const status = props.database.state === "ready" ? props.database.status : null;
  const credentialsReady = props.missingCredentials.length === 0;
  const signIn = status?.signInEvidence ?? null;

  const subscription: Step =
    signIn === "succeeded"
      ? { key: "subscription", title: "Woven subscription", state: "done", label: "Confirmed", detail: "Confirmed: Ask Sunny has signed in to the Operations API with it." }
      : signIn === "failed"
        ? { key: "subscription", title: "Woven subscription", state: "attention", label: "Sign-in refused", detail: "The last recorded sign-in was refused. Check the subscription and the application user in the Woven API portal." }
        : { key: "subscription", title: "Woven subscription", state: "reported", label: "Reported active", detail: "Shown as Active in the Woven API portal. Ask Sunny confirms it the first time it signs in." };

  const credentials: Step = credentialsReady
    ? { key: "credentials", title: "Server-side credentials", state: "done", label: "Configured", detail: "The subscription key and the Woven application user are set for this deployment." }
    : {
        key: "credentials",
        title: "Server-side credentials",
        state: "not_started",
        label: "Not configured",
        detail: `Not set in this deployment: ${props.missingCredentials.join(", ")}. Values are entered in Vercel as Sensitive variables, never in the app.`,
      };

  const signInStep: Step =
    signIn === "succeeded"
      ? { key: "signin", title: "Woven sign-in", state: "done", label: "Succeeded", detail: "A recorded run signed in and read employees." }
      : signIn === "failed"
        ? { key: "signin", title: "Woven sign-in", state: "attention", label: "Failed", detail: "The last recorded sign-in was refused." }
        : { key: "signin", title: "Woven sign-in", state: credentialsReady ? "pending" : "not_started", label: "Not yet confirmed", detail: credentialsReady ? "Run “Test Woven connection” below to confirm it." : "Needs the credentials first." };

  const response: Step = status?.lastSuccessAt
    ? { key: "response", title: "Live response check", state: "done", label: "Accepted", detail: "A sync has read and accepted Woven's responses." }
    : { key: "response", title: "Live response check", state: credentialsReady ? "pending" : "not_started", label: "Not yet reviewed", detail: "The read-only check compares Woven's real responses with what Ask Sunny expects. Its report is reviewed before anything is stored." };

  const directory: Step = (() => {
    switch (props.database.state) {
      case "ready":
        return { key: "directory", title: "Employee directory tables", state: "done", label: "Created", detail: "The directory, its change history and the run log exist." } as Step;
      case "missing":
        return { key: "directory", title: "Employee directory tables", state: "not_started", label: "Not created", detail: "The migration is prepared and is applied only with approval, after the live check." } as Step;
      case "unavailable":
        return { key: "directory", title: "Employee directory tables", state: "attention", label: "Could not be read", detail: `The database did not answer the status read${props.database.code ? ` (${props.database.code})` : ""}. This is not the same as the tables being missing.` } as Step;
      default:
        return { key: "directory", title: "Employee directory tables", state: "attention", label: "Database not configured", detail: "Supabase is not configured for this deployment." } as Step;
    }
  })();

  const firstSync: Step = status?.lastSuccessAt
    ? { key: "first", title: "First sync", state: "done", label: "Complete", detail: `Last successful sync: ${when(status.lastSuccessAt)} (Central).` }
    : { key: "first", title: "First sync", state: "not_started", label: "Not run", detail: "A preview run, then the first real sync, each approved and reviewed." };

  const schedule: Step = (() => {
    const base = { key: "schedule", title: "Daily sync" };
    if (props.scheduleDeployed && props.scheduleEnabled && status?.lastCronSuccessAt) {
      return { ...base, state: "done", label: "Running daily", detail: `Last scheduled sync: ${when(status.lastCronSuccessAt)} (Central).` } as Step;
    }
    if (props.scheduleDeployed && props.scheduleEnabled) {
      return { ...base, state: "pending", label: "Awaiting first run", detail: "The schedule is deployed and switched on; no scheduled run has succeeded yet." } as Step;
    }
    if (!props.scheduleDeployed && props.scheduleEnabled) {
      return { ...base, state: "attention", label: "Switch on, not scheduled", detail: "The schedule switch is on, but this build has no schedule for the sync, so nothing runs." } as Step;
    }
    if (props.scheduleDeployed) {
      return { ...base, state: "pending", label: "Deployed, switched off", detail: "The schedule is in this build but switched off." } as Step;
    }
    return { ...base, state: "not_started", label: "Not scheduled", detail: "Added only with approval, after the first sync has been reviewed." } as Step;
  })();

  return [subscription, credentials, signInStep, response, directory, firstSync, schedule];
}

function Chips({ items, tone }: { items: readonly string[]; tone: BadgeTone }) {
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

function StepBadge({ step }: { step: Step }) {
  return (
    <Badge tone={STATE_TONE[step.state]} size="sm" className="shrink-0 self-start">
      <StatusDot />
      {step.label}
    </Badge>
  );
}

export function WovenSyncScreen(props: WovenSyncPageProps) {
  const steps = stepsFor(props);
  const next = steps.find((s) => s.state !== "done" && s.state !== "reported");

  const kept = [
    "Woven employee ID and login ID",
    "External HRIS ID",
    "First, last and preferred first name",
    "Email address, as Woven provides it",
    "Active, terminated or unknown",
    "Hire and start date",
    "Termination date, last day worked and type",
    "Position and PositionID",
    "Primary location",
    "Additional locations",
    "Temporary or expiring access, with end date",
  ];

  return (
    <PageShell>
      <WovenHeader current="overview" sampleLabel={props.sampleLabel} />

      {props.overview ? <SummaryCards counts={props.overview} scheduleOn={props.scheduleDeployed && props.scheduleEnabled} /> : null}

      {next ? (
        <Notice tone="accent" icon={<ArrowRight />} title={`Next step: ${next.title}`} className="mb-6">
          {next.detail}
        </Notice>
      ) : (
        <Notice tone="accent" icon={<ShieldCheck />} title="Live and running daily" className="mb-6">
          Every go-live step is complete.
        </Notice>
      )}

      <SectionHeader title="Go-live steps" description="Each one is read from this deployment, not typed in." />
      <ol className="mb-8 flex flex-col divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
        {steps.map((step) => (
          <li key={step.key} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-foreground">{step.title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed break-words text-muted-foreground">{step.detail}</p>
            </div>
            <StepBadge step={step} />
          </li>
        ))}
      </ol>

      <ValidationPanel
        available={validationAvailable(props)}
        reason={validationUnavailableReason(props)}
        accessCodeRequired={!props.liveMode}
      />

      <SyncPanel
        available={props.liveMode && props.enabled && props.missingCredentials.length === 0}
        reason={
          !props.liveMode
            ? "This deployment runs in demo mode, where the sync is switched off."
            : !props.enabled
              ? "Disabled: WOVEN_SYNC_ENABLED is off for this deployment, so no employee sync can run. The connection test above does not need it."
              : props.missingCredentials.length > 0
                ? "Add the Woven credentials to this deployment first."
                : null
        }
      />

      <SectionHeader title="Built" description="Ships in this build and is covered by automated tests." />
      <ul className="mb-8 grid gap-3 sm:grid-cols-2">
        {BUILT.map(([title, detail]) => (
          <li key={title} className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
            <p className="text-[14px] font-semibold text-foreground">{title}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{detail}</p>
          </li>
        ))}
      </ul>

      <div className="mb-4 grid gap-6 lg:grid-cols-2">
        <section>
          <SectionHeader title="What Ask Sunny keeps" description="The only employee fields copied from Woven." />
          <Chips items={kept} tone="ready" />
        </section>
        <section>
          <SectionHeader title="Never copied" description="Left in Woven. These fields are never read." />
          <Chips items={NEVER_KEPT} tone="neutral" />
        </section>
      </div>
      {props.loginEmailDomains.length === 0 ? (
        <Notice tone="attention" className="mb-8" title="No login-email domain is set">
          Email addresses are stored as Woven provides them, and Woven has no separate work-email field, so some may be personal.
          Whether an address may ever be used to sign in is a separate rule, WOVEN_LOGIN_EMAIL_DOMAINS. It is not set, so nobody is
          login-eligible until the real company domains are confirmed.
        </Notice>
      ) : (
        <p className="mb-8 text-[13px] text-muted-foreground">
          Email addresses are stored as Woven provides them. Only addresses at {props.loginEmailDomains.join(", ")} would ever be
          login-eligible, and nothing uses that rule in this phase except the Access Preview.
        </p>
      )}

      <section className="mb-8">
        <SectionHeader title="Changes it tracks" description="Each one is recorded with before and after, and kept permanently." />
        <Chips items={TRACKED} tone="outline" />
      </section>

      <Notice tone="neutral" icon={<ShieldCheck />} title="Access stays exactly as it is">
        The sync records what Woven says. It does not create an account, does not turn off a login when
        someone is terminated, does not change anyone&apos;s role, scope level, primary salon or salon access,
        and does not call a position change a promotion unless a confirmed, ranked mapping proves it. Each of
        those needs a separate decision before it is switched on.
      </Notice>
    </PageShell>
  );
}
