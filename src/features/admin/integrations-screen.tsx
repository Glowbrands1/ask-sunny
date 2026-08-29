"use client";

import { useState } from "react";
import {
  BarChart3,
  FolderSync,
  HardDrive,
  Info,
  Library,
  Mail,
  Settings2,
  Sparkles,
  Star,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, SectionHeader } from "@/components/ui/layout";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/overlays";
import { DEMO_INTEGRATIONS } from "@/data/demo/integrations";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import type { Integration } from "@/types";
import { ServiceStatusPanel } from "./service-status";

const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  "folder-sync": FolderSync,
  "bar-chart-3": BarChart3,
  star: Star,
  library: Library,
  mail: Mail,
  "hard-drive": HardDrive,
};

const CATEGORY_LABEL: Record<Integration["category"], string> = {
  ai: "Assistant",
  documents: "Documents",
  reporting: "Reporting",
  reviews: "Reviews",
  communication: "Communication",
  storage: "Storage",
};

export function IntegrationsScreen() {
  const { storageAvailable } = useAppStore();
  const [selected, setSelected] = useState<Integration | null>(null);

  const connected = DEMO_INTEGRATIONS.filter(
    (integration) => integration.status === "connected",
  );
  const pending = DEMO_INTEGRATIONS.filter(
    (integration) => integration.status !== "connected",
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Admin"
        title="Integrations"
        description="What Ask Sunny connects to, and what it will connect to. Nothing on this page is faked — one integration is genuinely live."
      />

      {/* Live configuration first: it is the section an administrator actually
          needs, and it reflects this deployment rather than the roadmap. */}
      <ServiceStatusPanel />

      <Notice tone="neutral" icon={<Info />} className="mb-6">
        The list below is the integration roadmap. Exactly one item is connected
        today: the browser storage that makes uploads and saved forms survive a
        refresh. Everything else honestly reports &ldquo;Not
        connected&rdquo;.
      </Notice>

      <SectionHeader
        title="Connected"
        description="Working today, with no account or paid service required."
      />
      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {connected.map((integration) => (
          <IntegrationCard
            key={integration.id}
            integration={{
              ...integration,
              status: storageAvailable ? "connected" : "not_connected",
            }}
            onOpen={setSelected}
          />
        ))}
      </div>

      <SectionHeader
        title="Available to connect"
        description="Each one needs an account, access, or credentials that the client will provide."
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {pending.map((integration) => (
          <IntegrationCard
            key={integration.id}
            integration={integration}
            onOpen={setSelected}
          />
        ))}
      </div>

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {selected ? (
          <DialogContent
            title={selected.name}
            description={`${selected.vendor} · ${CATEGORY_LABEL[selected.category]}`}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                tone={selected.status === "connected" ? "ready" : "neutral"}
                size="sm"
              >
                <StatusDot />
                {selected.status === "connected" ? "Connected" : "Not connected"}
              </Badge>
            </div>

            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              {selected.description}
            </p>

            <div className="mt-4 rounded-[var(--radius-sm)] border border-border bg-surface-muted px-3.5 py-3">
              <p className="eyebrow">What connecting unlocks</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-foreground">
                {selected.unlocks}
              </p>
            </div>

            {selected.notes ? (
              <Notice tone="neutral" icon={<Info />} className="mt-4">
                {selected.notes}
              </Notice>
            ) : null}

            <DialogActions>
              <DialogClose asChild>
                <Button variant="ghost">Close</Button>
              </DialogClose>
              <Button disabled={selected.status === "connected"}>
                <Settings2 />
                {selected.status === "connected"
                  ? "Already connected"
                  : "Configure (coming later)"}
              </Button>
            </DialogActions>
          </DialogContent>
        ) : null}
      </Dialog>
    </PageShell>
  );
}

function IntegrationCard({
  integration,
  onOpen,
}: {
  integration: Integration;
  onOpen: (integration: Integration) => void;
}) {
  const Icon = ICONS[integration.iconKey] ?? Settings2;
  const isConnected = integration.status === "connected";

  return (
    <Card interactive>
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)]",
              isConnected
                ? "bg-accent-soft text-accent-soft-foreground"
                : "bg-surface-muted text-muted-foreground",
            )}
          >
            <Icon className="size-4.5" aria-hidden />
          </span>
          <Badge tone={isConnected ? "ready" : "neutral"} size="sm">
            <StatusDot />
            {isConnected ? "Connected" : "Not connected"}
          </Badge>
        </div>

        <h3 className="mt-3.5 text-[15px] font-semibold text-foreground">
          {integration.name}
        </h3>
        <p className="text-xs text-subtle-foreground">{integration.vendor}</p>

        <p className="mt-2.5 flex-1 text-[13px] leading-relaxed text-muted-foreground">
          {integration.description}
        </p>

        <Button
          variant="secondary"
          size="sm"
          className="mt-4 w-full"
          onClick={() => onOpen(integration)}
        >
          {isConnected ? "View details" : "Configure"}
        </Button>
      </CardContent>
    </Card>
  );
}
