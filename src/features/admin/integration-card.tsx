"use client";

import {
  BarChart3,
  FolderSync,
  HardDrive,
  Library,
  Mail,
  Sparkles,
  Settings2,
  Star,
  type LucideIcon,
} from "lucide-react";

import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { Integration } from "@/types";

/**
 * One integration card.
 *
 * Its own module so the parent screen and the demo-only roadmap chunk can
 * each render a card without the parent importing the chunk — which would
 * have pulled the seeded roadmap back into the production bundle and undone
 * the point of loading it dynamically.
 */
const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  "folder-sync": FolderSync,
  "bar-chart-3": BarChart3,
  star: Star,
  library: Library,
  mail: Mail,
  "hard-drive": HardDrive,
};

export function IntegrationCard({
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
