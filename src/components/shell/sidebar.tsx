"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, ChevronsLeft, Lock } from "lucide-react";

import { BrandMark, SunMark } from "@/components/brand-mark";
import { Tooltip } from "@/components/ui/overlays";
import { useSession } from "@/lib/session/session-context";
import { NotificationBell } from "@/features/notifications/notification-bell";
import type { BellData } from "@/lib/notifications/types";
import { cn } from "@/lib/utils/cn";
import { AppSwitcher } from "./app-switcher";
import { isActivePath, visibleNavSections } from "./navigation";
import { useWhatsNewVisible } from "@/features/whats-new/whats-new-access";
import { useWhatsNewUnseen } from "@/features/whats-new/whats-new-seen";
import { whatsNewFor } from "@/config/whats-new";
import { UserMenu } from "./user-menu";

export function SidebarNav({
  collapsed,
  onToggleCollapse,
  onNavigate,
  variant = "desktop",
  overdueFollowUps = 0,
  showAppSwitcher = false,
  showLeadershipHub = false,
  meetingTabs = [],
  bell = null,
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  variant?: "desktop" | "drawer";
  /** Counted on the server by the (app) layout. Zero hides the badge. */
  overdueFollowUps?: number;
  /** Decided on the server by the (app) layout: administrators only. */
  showAppSwitcher?: boolean;
  /** Server-decided yes/no for the Leadership Hub tab. */
  showLeadershipHub?: boolean;
  /**
   * The DM L10 tab(s): decided on the server by the (app) layout from the Leadership Hub, which lists only the
   * meetings this person attends and Ask Sunny may open. Not a boundary: the page and every action re-check.
   */
  meetingTabs?: { href: string; label: string }[];
  /**
   * The signed-in person's notifications (the layout's `bellForLayout`): a labelled "Notifications" bar in the rail
   * (Pau, 23 Nov 2026: "i dont want a bell, i need a bar"), directly under Overview, on desktop and in the phone drawer
   * ("a notification bar instead below the overview"). The top bar has no bell. Null: no bar.
   */
  bell?: BellData | null;
}) {
  const pathname = usePathname();
  const { can, isAdmin, demoMode, user } = useSession();

  /*
   * WHAT THE RAIL HIDES, AND WHAT IT MUST NOT.
   *
   * Hiding a screen a role cannot use is right once somebody has decided who
   * may do what. Nobody has: the matrix behind `can()` is this app's own guess,
   * and hiding on it left Form Templates off the rail for a Salon Director —
   * with the page gate already stood down, that meant the screen existed and
   * there was NO WAY IN. "I don't see it on the app" was exactly that.
   *
   * So in preview the permission filter does not remove items; the page itself
   * says what the permission will be once roles are configured. The ADMIN
   * section is still gated, because Owner/Developer there is a fixed decision
   * rather than a guess — see `ADMIN_CONSOLE_ROLES`.
   *
   * When identity is real this reverts to filtering on a verified role, and the
   * server refuses independently either way.
   */
  const whatsNewVisible = useWhatsNewVisible();
  // The newest What's New entry this person may see; the entry wiggles with a "New" dot until they open the page.
  const whatsNewLatest = whatsNewVisible ? (whatsNewFor(user.role, (_role, permission) => can(permission))[0]?.date ?? null) : null;
  const whatsNewUnseen = useWhatsNewUnseen(user?.id ?? "", whatsNewLatest, pathname === "/whats-new");
  const sections = visibleNavSections({ can, isAdmin, demoMode, whatsNewVisible });
  if (meetingTabs.length > 0) {
    const meetings = { id: "meetings", label: "Meetings", items: meetingTabs.map((t) => ({ label: t.label, href: t.href, icon: CalendarCheck })) };
    const after = sections.findIndex((s) => s.id === "assistant");
    sections.splice(after < 0 ? 0 : after + 1, 0, meetings);
  }

  const isCollapsed = variant === "desktop" && collapsed;

  /*
   * NOTIFICATIONS, DIRECTLY UNDER OVERVIEW (Pau, 23 Nov 2026, of the top-bar bell: "can we remove this and add a
   * notification bar instead below the overview"; confirmed with a screenshot: in the Home group, above Assistant).
   * On desktop and in the phone drawer alike; the top bar no longer has a bell. Someone whose rail has no Overview still
   * gets it, as the rail's first item, so nobody who had the bell loses it.
   */
  const bellUnderOverview = sections.some((section) => section.items.some((item) => item.href === "/"));
  const bellItem = bell ? (
    <NotificationBell
      data={bell}
      variant="rail"
      collapsed={isCollapsed}
      onNavigate={onNavigate}
      panelSide={variant === "drawer" ? "bottom" : "right"}
    />
  ) : null;

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/*
        THE DRAWER ONLY. On desktop the shell's navy top bar carries the
        wordmark, so repeating it here would put two Ask Sunny marks on screen.
        The drawer slides over the content with no bar above it, so it still
        needs one.
      */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-border",
          isCollapsed ? "justify-center px-2" : "justify-between px-5",
          variant === "desktop" && "hidden",
        )}
      >
        {isCollapsed ? (
          <Link href="/" aria-label="Ask Sunny — Overview" onClick={onNavigate}>
            <SunMark className="size-6" />
          </Link>
        ) : (
          <Link href="/" onClick={onNavigate} aria-label="Ask Sunny — Overview">
            <BrandMark size="md" />
          </Link>
        )}
      </div>

      <nav
        aria-label="Main"
        className="scroll-slim flex-1 overflow-y-auto px-3 py-4"
      >
        {bell && !bellUnderOverview ? <div className="mb-4">{bellItem}</div> : null}
        {sections.map((section) => (
          <div key={section.id} className="mb-5 last:mb-0">
            {!isCollapsed ? (
              <p
                className={cn(
                  /*
                    THE RAIL'S OWN INK, not the canvas muted `.eyebrow` paints
                    itself with — that lands at 1.92:1 on #b2aeaa. Of the
                    approved values only #2b2926 and #454240 clear 4.5:1 on this
                    surface, and section labels take the lighter of the two.
                  */
                  "eyebrow mb-2 flex items-center gap-1.5 px-2.5 text-sidebar-muted",
                  section.admin && "text-brand-yellow-soft-foreground",
                )}
              >
                {section.admin ? <Lock className="size-2.5" aria-hidden /> : null}
                {section.label}
              </p>
            ) : (
              <div className="mx-auto mb-2 h-px w-6 bg-border" aria-hidden />
            )}

            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActivePath(pathname, item);
                const Icon = item.icon;
                const link = (
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-full text-[13.5px] font-semibold transition-colors",
                      item.whatsNew && "whats-new-glitter",
                      item.whatsNew && whatsNewUnseen && "whats-new-shake",
                      isCollapsed ? "justify-center px-0 py-2.5" : "px-3.5 py-2.5",
                      /*
                       * SELECTED AND HOVERED BOTH LAND ON THE CANVAS, which is
                       * what the approved mockup shows: a pale pill on the grey
                       * rail. The previous pair was two greys a shade apart, so
                       * hovering an item barely changed it and the selected one
                       * still read as dark.
                       *
                       * What separates them is depth and weight, not hue — the
                       * selected item keeps its shadow and its coloured icon,
                       * so a hover never impersonates the current page.
                       */
                      active
                        ? "bg-sidebar-active text-sidebar-active-foreground shadow-rail-active"
                        : "text-sidebar-foreground hover:bg-hover-surface hover:text-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        active
                          ? "text-sidebar-active-foreground"
                          : "text-sidebar-foreground group-hover:text-foreground",
                      )}
                      aria-hidden
                    />
                    {/* The third glitter sparkle (`.whats-new-glitter` in globals.css; the owner, 28 Nov 2026). */}
                    {item.whatsNew ? <span aria-hidden className="whats-new-glitter-third" /> : null}
                    {!isCollapsed ? (
                      <span className="truncate">{item.label}</span>
                    ) : (
                      <span className="sr-only">{item.label}</span>
                    )}

                    {/*
                      COUNTS, NOT HUES. The direction's rule for the rail: add
                      information, not a colour per section. Giving each section
                      its own hue looks organised in a mockup and breaks
                      immediately, because section colour and status colour then
                      mean different things within the same twelve pixels.

                      This is the SAME overdue count the band and the Overview
                      report — one meaning, three places — and it only renders
                      when there is something to act on.
                    */}
                    {item.href === "/forms/monitoring" && overdueFollowUps > 0 ? (
                      <span
                        className={cn(
                          "grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-followup-attention px-1.5 text-[8px] font-black text-followup-attention-foreground",
                          isCollapsed
                            ? "absolute top-1 right-1"
                            : "ml-auto",
                        )}
                      >
                        {overdueFollowUps}
                        <span className="sr-only"> overdue follow-ups</span>
                      </span>
                    ) : null}
                    {item.whatsNew && whatsNewUnseen ? (
                      <span
                        className={cn(
                          "whats-new-dot shrink-0 rounded-full bg-followup-attention text-[9px] font-black tracking-wide text-followup-attention-foreground uppercase",
                          isCollapsed ? "absolute top-1.5 right-1.5 size-2" : "ml-auto px-1.5 py-0.5 leading-none",
                        )}
                      >
                        {isCollapsed ? <span className="sr-only">New updates</span> : <>New<span className="sr-only"> updates</span></>}
                      </span>
                    ) : null}
                    {!isCollapsed && section.admin ? (
                      <span
                        aria-hidden
                        className="ml-auto rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary-soft-foreground uppercase"
                      >
                        Admin
                      </span>
                    ) : null}
                  </Link>
                );

                return (
                  <Fragment key={item.href}>
                    <li>
                      {isCollapsed ? (
                        <Tooltip content={item.label} side="right">
                          {link}
                        </Tooltip>
                      ) : (
                        link
                      )}
                    </li>
                    {bell && bellUnderOverview && item.href === "/" ? <li>{bellItem}</li> : null}
                  </Fragment>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        {variant === "desktop" && onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            className={cn(
              "mb-2 flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-xs font-medium text-sidebar-muted transition-colors hover:bg-hover-surface hover:text-foreground",
              isCollapsed && "justify-center px-0",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <ChevronsLeft
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                collapsed && "rotate-180",
              )}
              aria-hidden
            />
            {!isCollapsed ? "Collapse sidebar" : null}
          </button>
        ) : null}
        <UserMenu collapsed={isCollapsed} onNavigate={onNavigate} />
        {/* Last on the rail, below the profile: administrators only. */}
        {showAppSwitcher ? <AppSwitcher
            collapsed={isCollapsed}
            showLeadershipHub={showLeadershipHub}
            className="mt-1.5"
          /> : null}
      </div>
    </div>
  );
}
