"use client";

import { Check, ChevronsUpDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { cn } from "@/lib/utils/cn";

/**
 * THE TWO-WAY SWITCHER BETWEEN ASK SUNNY AND ASK BUBBLES.
 *
 * The two are separate applications — separate deployments, Supabase projects,
 * employee records, permissions and branding — and this does not change that.
 * Choosing the other app is a plain full-page navigation to its production
 * URL. Nothing is handed across: no token, no session, no account. The
 * destination's own sign-in and access checks decide what happens next, so
 * someone without an Ask Bubbles account simply lands on its login screen.
 *
 * ADMINISTRATORS ONLY. Whether to render this at all is decided on the server
 * from the verified identity (`pageShowsAppSwitcher`, src/lib/auth); the sidebar
 * simply does not mount it otherwise. This app holds no record of who may use
 * the other one, so an administrator here is offered the link, and the other
 * app's own login and roles decide whether it lets them in.
 *
 * Mirrored in Ask Bubbles (src/components/shell/app-switcher.tsx) with only
 * CURRENT_APP and the rail styling changed.
 */
export const SWITCHABLE_APPS = [
  {
    id: "ask-sunny",
    emoji: "☀️",
    name: "Ask Sunny",
    company: "Sun Tan City",
    url: "https://ask-sunny.vercel.app",
  },
  {
    id: "ask-bubbles",
    emoji: "🫧",
    name: "Ask Bubbles",
    company: "Buff City Soap",
    url: "https://askbubbles.vercel.app",
  },
] as const;

const CURRENT_APP = "ask-sunny";

export function AppSwitcher({
  collapsed,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  const current = SWITCHABLE_APPS.find((app) => app.id === CURRENT_APP)!;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Switch app — current: ${current.name}`}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] p-2 text-left transition-colors hover:bg-hover-surface data-[state=open]:bg-hover-surface",
            collapsed && "justify-center p-1.5",
            className,
          )}
        >
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-base shadow-soft"
          >
            {current.emoji}
          </span>
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] text-sidebar-muted">Switch app</span>
                <span className="block truncate text-[13px] font-medium text-foreground">
                  {current.name}
                </span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-muted" aria-hidden />
            </>
          ) : null}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side={collapsed ? "right" : "top"}
        className="w-64 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel>Switch app</DropdownMenuLabel>
        {SWITCHABLE_APPS.map((app) => {
          const active = app.id === CURRENT_APP;
          const body = (
            <>
              <span aria-hidden className="text-base leading-none">
                {app.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{app.name}</span>
                <span
                  className={cn(
                    "block truncate text-xs",
                    active ? "text-primary-soft-foreground" : "text-muted-foreground",
                  )}
                >
                  {app.company}
                </span>
              </span>
              {active ? <Check className="!text-primary-soft-foreground" aria-hidden /> : null}
            </>
          );

          // The current app is highlighted and does nothing; only the other one navigates.
          return active ? (
            <DropdownMenuItem
              key={app.id}
              aria-current="true"
              className="bg-primary-soft text-primary-soft-foreground data-highlighted:bg-primary-soft"
            >
              {body}
              <span className="sr-only"> (current app)</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={app.id} asChild>
              {/* A plain anchor, not next/link: this leaves the app entirely. */}
              <a href={app.url}>{body}</a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
