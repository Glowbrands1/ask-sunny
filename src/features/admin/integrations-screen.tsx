"use client";

import Link from "next/link";
import { useState } from "react";
import { Info, Settings2, Star } from "lucide-react";

import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, SectionHeader } from "@/components/ui/layout";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/overlays";
import { BROWSER_STORAGE_INTEGRATION } from "@/data/integrations";
import { IntegrationCard } from "./integration-card";
import { demoRuntime } from "@/lib/demo/runtime";
import { isDemoMode } from "@/lib/config/runtime";
import { useAppStore } from "@/lib/store/app-store";
import type { Integration } from "@/types";
import { ServiceStatusPanel } from "./service-status";

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

  /*
   * ==========================================================================
   * WHAT SURVIVES INTO LIVE, AND WHY IT IS NOT THE WHOLE PAGE
   * ==========================================================================
   *
   * A correction worth recording, because the first reading of this screen was
   * harsher than it deserved: the roadmap cards are NOT fabricated statuses.
   * Every one of them reports "Not connected", which is true, and the single
   * "Connected" card reads its status from `storageAvailable` — a real
   * capability check on this browser. The page header says as much.
   *
   * What they ARE is a roadmap: a list of tool names the product intends to
   * integrate with, rendered as status cards on an administration screen
   * beside genuine configuration. On a live deployment that invites an
   * administrator to read "Microsoft SharePoint — Not connected" as a finding
   * about their tenancy rather than as a plan, and the two are indistinguishable
   * at a glance.
   *
   * So live keeps everything that describes THIS deployment — the
   * `/api/health` panel, the Google Reviews source screen, and the storage
   * card whose status is measured — and drops the forward-looking list. Demo
   * keeps the roadmap, which is what it is for.
   */
  const live = !isDemoMode();
  /*
   * From the demo boundary: null in a production build, so the seeded roadmap
   * is never emitted rather than merely never fetched.
   */
  const RoadmapDemo = demoRuntime.screens.integrationsRoadmap;

  /*
   * ONE REAL CARD, AND ITS STATUS IS MEASURED. Everything else on this screen
   * that described a connection was a roadmap; this is the browser's own
   * storage, reported from `storageAvailable`.
   */
  const connected = [BROWSER_STORAGE_INTEGRATION];

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

      {/*
        THE ONE INTEGRATION WITH A SCREEN OF ITS OWN, because it is the one that
        starts jobs and spends money. Its status — locations mapped, last run,
        what that run fetched and what Apify charged — does not fit a card in a
        roadmap list, and putting it on the Google Reviews dashboard would show
        run ids and Place IDs to every district manager reading a review.
      */}
      <Notice tone="accent" icon={<Star />} className="mb-6">
        <span className="font-semibold">Google Reviews</span> can sync server-side through
        Apify, with no browser open.{" "}
        <Link
          href="/admin/integrations/google-reviews"
          className="font-semibold underline underline-offset-4"
        >
          Open the Google Review Source screen
        </Link>{" "}
        to map the fifteen locations, run a sync now, and see what the last run did.
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

      {/*
        THE ROADMAP. Demo only, and dynamically imported so it is not shipped
        to a live deployment at all — see the note at the top of this file.
      */}
      {live || !RoadmapDemo ? null : <RoadmapDemo onOpen={setSelected} />}

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
