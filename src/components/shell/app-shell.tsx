"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Menu, Search, X } from "lucide-react";

import { BrandMark, ParentBrandLockup } from "@/components/brand-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { LoginScreen } from "@/features/auth/login-screen";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils/cn";
import { usePreference, writePreference } from "@/lib/utils/client-store";
import { JumpToRow } from "./jump-to-row";
import { SidebarNav } from "./sidebar";
import { GlobalSearch } from "./global-search";

const COLLAPSE_KEY = "ask-sunny:sidebar-collapsed";

export function AppShell({
  children,
  /**
   * Overdue follow-ups, counted on the server by the layout so the rail badge
   * cannot disagree with the page it links to. Zero hides it.
   */
  overdueFollowUps = 0,
}: {
  children: ReactNode;
  overdueFollowUps?: number;
}) {
  const { hydrated, signedIn, demoMode } = useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Read straight from the external store — no effect, no cascading render.
  const collapsed = usePreference("local", COLLAPSE_KEY, "0") === "1";

  const toggleCollapse = () => {
    writePreference("local", COLLAPSE_KEY, collapsed ? "0" : "1");
  };

  // Before hydration we cannot know whether a demo session exists, so show a
  // neutral splash rather than flashing the login screen.
  if (!hydrated) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <BrandMark size="lg" />
          <p className="text-[13px] text-muted-foreground">Loading your workspace…</p>
        </div>
      </div>
    );
  }

  // Not signed in: render the login experience inline. No redirect, so there is
  // no navigation race between hydration and the auth check.
  if (!signedIn) return <LoginScreen />;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/*
        THE SHARED TOP BAR. Navy, full width, above BOTH the rail and the
        content — the approved storefront structure, and it belongs to the shell
        rather than to any one page. Putting it on the reporting page alone
        would have made reporting look like a different product.
      */}
      <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 bg-chrome px-4 sm:px-5">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          onClick={() => setDrawerOpen(true)}
          className="text-topbar-foreground hover:bg-hover-surface hover:text-hover-surface-foreground lg:hidden"
        >
          <Menu />
        </Button>

        <Link href="/" aria-label="Ask Sunny — Overview" className="shrink-0">
          <BrandMark size="md" onDark />
        </Link>

        <div className="ml-auto flex items-center gap-1.5">
          {demoMode ? (
            <Badge tone="primary" size="sm">
              Demo
            </Badge>
          ) : null}
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Search Ask Sunny"
                className="text-chrome-foreground hover:bg-hover-surface hover:text-hover-surface-foreground"
              >
                <Search />
              </Button>
            </DialogTrigger>
            <DialogContent
              title="Search Ask Sunny"
              description="Documents, videos, forms, salons and screens."
              wide
            >
              <GlobalSearch />
            </DialogContent>
          </Dialog>
          {/*
            The parent brand is present without competing: hidden on the
            narrowest widths, where the product mark has to win outright.
          */}
          <ParentBrandLockup className="hidden sm:inline-flex" />
        </div>
      </header>

      {/*
        THE SHORTCUTS LIVE IN THE CHROME. All six already exist in the left
        rail, so as one quiet uniform row above the content they read as
        navigation instead of competing with the page's hero. They were six
        white elevated cards on the canvas, which made them the loudest object
        on the Overview.
      */}
      <JumpToRow />

      <div className="flex min-h-0 min-w-0 flex-1">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-16 hidden h-[calc(100dvh-4rem)] shrink-0 border-r border-rail-border transition-[width] duration-200 lg:block",
          collapsed ? "w-[68px]" : "w-64",
        )}
      >
        <SidebarNav
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          overdueFollowUps={overdueFollowUps}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile drawer */}
        {drawerOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-[color-mix(in_srgb,var(--foreground)_32%,transparent)] backdrop-blur-[2px]"
              onClick={() => setDrawerOpen(false)}
            />
            <div className="animate-in-fade absolute inset-y-0 left-0 w-[min(19rem,86vw)] border-r border-border shadow-float">
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="Close navigation"
                className="absolute top-3.5 right-3 z-10"
                onClick={() => setDrawerOpen(false)}
              >
                <X />
              </Button>
              <SidebarNav
                variant="drawer"
                onNavigate={() => setDrawerOpen(false)}
                overdueFollowUps={overdueFollowUps}
              />
            </div>
          </div>
        ) : null}

        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
      </div>
    </div>
  );
}

/** Desktop-only utility bar used on pages with a global search affordance. */
export function DesktopSearchLauncher({ className }: { className?: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "hidden w-56 items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-left text-[13px] text-muted-foreground shadow-soft transition-colors hover:border-border-strong lg:flex",
            className,
          )}
        >
          <Search className="size-3.5 shrink-0" aria-hidden />
          <span className="flex-1 truncate">Search Ask Sunny</span>
        </button>
      </DialogTrigger>
      <DialogContent
        title="Search Ask Sunny"
        description="Documents, videos, forms, salons and screens."
        wide
      >
        <GlobalSearch />
      </DialogContent>
    </Dialog>
  );
}
