"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, Lock } from "lucide-react";

import { BrandMark, SunMark } from "@/components/brand-mark";
import { Tooltip } from "@/components/ui/overlays";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils/cn";
import { NAV_SECTIONS, isActivePath } from "./navigation";
import { UserMenu } from "./user-menu";

export function SidebarNav({
  collapsed,
  onToggleCollapse,
  onNavigate,
  variant = "desktop",
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  variant?: "desktop" | "drawer";
}) {
  const pathname = usePathname();
  const { can, isAdmin, demoMode } = useSession();

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
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (section.admin && !isAdmin) return false;
      if (!item.permission) return true;
      if (demoMode) return true;
      return can(item.permission);
    }),
  })).filter((section) => section.items.length > 0);

  const isCollapsed = variant === "desktop" && collapsed;

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
        {sections.map((section) => (
          <div key={section.id} className="mb-5 last:mb-0">
            {!isCollapsed ? (
              <p
                className={cn(
                  "eyebrow mb-2 flex items-center gap-1.5 px-2.5",
                  section.admin && "text-primary-soft-foreground",
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
                      "group flex items-center gap-2.5 rounded-[var(--radius-sm)] text-[13px] font-medium transition-colors",
                      isCollapsed ? "justify-center px-0 py-2.5" : "px-2.5 py-2",
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
                        ? "bg-sidebar-active text-foreground shadow-soft"
                        : "text-sidebar-muted hover:bg-hover-surface hover:text-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        active ? "text-primary" : "text-sidebar-muted group-hover:text-foreground",
                      )}
                      aria-hidden
                    />
                    {!isCollapsed ? (
                      <span className="truncate">{item.label}</span>
                    ) : (
                      <span className="sr-only">{item.label}</span>
                    )}
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
                  <li key={item.href}>
                    {isCollapsed ? (
                      <Tooltip content={item.label} side="right">
                        {link}
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <UserMenu collapsed={isCollapsed} onNavigate={onNavigate} />
        {variant === "desktop" && onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            className={cn(
              "mt-2 flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-xs font-medium text-sidebar-muted transition-colors hover:bg-hover-surface hover:text-foreground",
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
      </div>
    </div>
  );
}
