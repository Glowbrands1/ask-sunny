"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Menu, Search, X } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { LoginScreen } from "@/features/auth/login-screen";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils/cn";
import { usePreference, writePreference } from "@/lib/utils/client-store";
import { SidebarNav } from "./sidebar";
import { GlobalSearch } from "./global-search";

const COLLAPSE_KEY = "ask-sunny:sidebar-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
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
    <div className="flex min-h-dvh bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 border-r border-border transition-[width] duration-200 lg:block",
          collapsed ? "w-[68px]" : "w-64",
        )}
      >
        <SidebarNav collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile / tablet top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-[color-mix(in_srgb,var(--background)_88%,transparent)] px-4 backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu />
            </Button>
            <Link href="/" aria-label="Ask Sunny — Overview">
              <BrandMark size="sm" />
            </Link>
          </div>
          <div className="flex items-center gap-1.5">
            {demoMode ? (
              <Badge tone="primary" size="sm">
                Demo
              </Badge>
            ) : null}
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Search Ask Sunny">
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
          </div>
        </header>

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
              <SidebarNav variant="drawer" onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        ) : null}

        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
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
