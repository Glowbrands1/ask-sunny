"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Notice, SkeletonRows } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/layout";
import { cn } from "@/lib/utils/cn";

/**
 * SERVICE CONFIGURATION — the admin-facing view of /api/health.
 *
 * What this screen may show is constrained by what the endpoint returns, and
 * the endpoint returns variable NAMES only. There is no code path here that
 * could render a secret, because no secret is ever in the payload. The one
 * masking rule that matters is upstream, not in this component.
 *
 * It also refuses to overstate: "configured" means the variable is set, not
 * that the service answered. The endpoint reports `verified: false` and this
 * screen says so in plain words, because an admin who reads a green tick as
 * "working" will misdiagnose the first real outage.
 */

/** Mirrors the /api/health response. Names only — never values. */
interface HealthPayload {
  mode: "demo" | "live";
  configured: boolean;
  missingEnvironmentVariables: string[];
  configurationProblems: string[];
  securityWarnings: string[];
  services: {
    anthropic: ServiceEntry;
    voyage: ServiceEntry;
    supabase: ServiceEntry & {
      secretKeySource: "current" | "legacy" | null;
      browserPublishableKey: { configured: boolean; requiredNow: boolean; note: string };
    };
    authentication: {
      kind: string;
      name: string;
      productionGrade: boolean;
      missing: string[];
      detail: string;
      unauthenticatedAccessAllowed: boolean;
    };
  };
  models: {
    claude: string;
    embedding: string;
    embeddingDimensions: number;
    embeddingDimensionMismatch: boolean;
  };
  rateLimit: { name: string; distributed: boolean };
  verified: boolean;
}

interface ServiceEntry {
  configured: boolean;
  missing: string[];
}

/**
 * The fetch itself, deliberately outside the component and free of any state.
 *
 * That keeps the effect below a pure subscription: it starts the request and
 * writes state only from the promise callbacks, which is the shape React's
 * guidance asks for and avoids a cascading render on mount.
 */
async function loadHealth(signal?: AbortSignal): Promise<HealthPayload> {
  const response = await fetch("/api/health", { signal, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`The health endpoint returned ${response.status}.`);
  }
  return (await response.json()) as HealthPayload;
}

function describe(caught: unknown): string {
  return caught instanceof Error
    ? caught.message
    : "Service configuration could not be read.";
}

export function ServiceStatusPanel() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    loadHealth(controller.signal)
      .then((payload) => {
        setHealth(payload);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(describe(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  /** Manual refresh. An event handler, so writing state here is fine. */
  const refresh = () => {
    setLoading(true);
    setError(null);
    loadHealth()
      .then((payload) => {
        setHealth(payload);
        setError(null);
      })
      .catch((caught: unknown) => setError(describe(caught)))
      .finally(() => setLoading(false));
  };

  return (
    <div className="mb-8">
      <SectionHeader
        title="Service configuration"
        description="Which production services this deployment is configured for. Variable names only — no key or secret value is ever sent to this screen."
        actions={
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={refresh}
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
        }
      />

      {loading && !health ? (
        <SkeletonRows rows={4} />
      ) : error ? (
        <Notice tone="attention" icon={<AlertTriangle />}>
          {error}
        </Notice>
      ) : health ? (
        <HealthReport health={health} />
      ) : null}
    </div>
  );
}

function HealthReport({ health }: { health: HealthPayload }) {
  const live = health.mode === "live";

  return (
    <div className="space-y-4">
      {/* Mode is the first thing an admin needs, and the two modes mean
          completely different things about whether answers are real. */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone={live ? "accent" : "processing"} size="md">
                <StatusDot />
                {live ? "Live mode" : "Demo mode"}
              </Badge>
              {live ? (
                <Badge tone={health.configured ? "ready" : "failed"} size="md">
                  <StatusDot />
                  {health.configured ? "Configured" : "Not configured"}
                </Badge>
              ) : null}
            </div>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              {live
                ? "Answers are generated by Claude from indexed company documents. If a service is unavailable, Ask Sunny reports the failure — it never falls back to demo answers."
                : "Answers come from a seeded demo corpus and no external service is contacted. Nothing on this page needs to be configured for the demo to work."}
            </p>
          </div>
        </CardContent>
      </Card>

      {health.securityWarnings.length > 0 ? (
        <Notice tone="attention" icon={<ShieldAlert />} title="Security">
          <ul className="mt-1 space-y-1.5">
            {health.securityWarnings.map((warning) => (
              <li key={warning} className="leading-relaxed">
                {warning}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {health.configurationProblems.length > 0 ? (
        <Notice tone="attention" icon={<AlertTriangle />} title="Configuration problems">
          <ul className="mt-1 space-y-1.5">
            {health.configurationProblems.map((problem) => (
              <li key={problem} className="leading-relaxed">
                {problem}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <ServiceRow
          name="Claude (Anthropic)"
          purpose="Generates grounded answers from retrieved company documents."
          configured={health.services.anthropic.configured}
          missing={health.services.anthropic.missing}
          required={live}
          detail={`Model: ${health.models.claude}`}
        />
        <ServiceRow
          name="Voyage AI"
          purpose="Embeds documents at upload and questions at ask time."
          configured={health.services.voyage.configured}
          missing={health.services.voyage.missing}
          required={live}
          detail={`Model: ${health.models.embedding} · ${health.models.embeddingDimensions} dimensions`}
          problem={
            health.models.embeddingDimensionMismatch
              ? "The model's vector width does not match the database column."
              : undefined
          }
        />
        <ServiceRow
          name="Supabase"
          purpose="Stores original documents privately, plus the chunks and vectors Sunny searches."
          configured={health.services.supabase.configured}
          missing={health.services.supabase.missing}
          required={live}
          detail={
            health.services.supabase.secretKeySource === "legacy"
              ? "Using the legacy service_role key name. SUPABASE_SECRET_KEY is the current one."
              : health.services.supabase.secretKeySource === "current"
                ? "Using the current secret key name."
                : undefined
          }
        />
        <ServiceRow
          name="Authentication"
          purpose="Decides who is making a request and what they may do."
          configured={health.services.authentication.productionGrade}
          missing={health.services.authentication.missing}
          required={live}
          detail={health.services.authentication.detail}
          problem={
            health.services.authentication.unauthenticatedAccessAllowed
              ? "Unauthenticated access is explicitly enabled. This must never be set on a reachable deployment."
              : undefined
          }
        />
      </div>

      <Card>
        <CardContent className="p-5">
          <p className="eyebrow mb-2">Rate limiting</p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {health.rateLimit.name}.{" "}
            {health.rateLimit.distributed
              ? "Limits are shared across server instances."
              : "Counters live in each server instance's memory, so the effective limit is multiplied by the number of instances. This guards against a runaway client burning API credit; it is not protection against a distributed attacker."}
          </p>
        </CardContent>
      </Card>

      <Notice tone="neutral" icon={<Info />}>
        <span className="font-semibold text-foreground">
          Configured is not the same as working
        </span>
        <p className="mt-0.5">
          This page reports whether the environment variables are set. It makes
          no request to any external service, so it cannot tell you whether a
          key is valid, whether the database has been migrated, or whether the
          storage bucket exists. Those are only proven by a real upload and a
          real question.
        </p>
      </Notice>
    </div>
  );
}

function ServiceRow({
  name,
  purpose,
  configured,
  missing,
  required,
  detail,
  problem,
}: {
  name: string;
  purpose: string;
  configured: boolean;
  missing: string[];
  required: boolean;
  detail?: string;
  problem?: string;
}) {
  const tone = problem
    ? "failed"
    : configured
      ? "ready"
      : required
        ? "attention"
        : "neutral";

  const Icon = problem ? AlertTriangle : configured ? CheckCircle2 : Circle;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-foreground">{name}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {purpose}
            </p>
          </div>
          <Badge tone={tone} size="sm" className="shrink-0">
            <Icon className={cn("size-3", problem && "text-status-failed")} aria-hidden />
            {problem
              ? "Problem"
              : configured
                ? "Configured"
                : required
                  ? "Required"
                  : "Not needed yet"}
          </Badge>
        </div>

        {problem ? (
          <p className="mt-3 text-[13px] leading-relaxed text-status-attention">
            {problem}
          </p>
        ) : null}

        {detail ? (
          <p className="mt-3 text-xs leading-relaxed text-subtle-foreground">{detail}</p>
        ) : null}

        {missing.length > 0 ? (
          <div className="mt-3">
            <p className="eyebrow mb-1.5">Not set</p>
            <div className="flex flex-wrap gap-1.5">
              {missing.map((variable) => (
                <code
                  key={variable}
                  className="rounded-[var(--radius-xs)] border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  {variable}
                </code>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
