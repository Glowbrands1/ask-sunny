"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { Check, LogOut, RotateCcw, Settings, UserCog } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { DEMO_SWITCHABLE_ROLES } from "@/data/demo/users";
import { ROLE_LABEL } from "@/lib/permissions";
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import type { Role } from "@/types";

/**
 * Profile menu — and, in demo mode only, the **Demo role** switcher.
 *
 * The switcher is a presentation aid: it swaps the active role so navigation
 * and permissions visibly change on stage. It is isolated in this one
 * component, clearly labelled, and gated on `demoMode` — with real
 * authentication configured, `setDemoRole` THROWS, so rendering it would be
 * offering a control that cannot work.
 *
 * Two other items are conditional for the same kind of reason. "Reset demo
 * data" clears seeded browser content, which is meaningless to a real user and
 * alarming to read. And the two administrative links are permission-gated: a
 * menu entry that always bounces is a bug report, not a boundary.
 */
export function UserMenu({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { user, role, scopeLabel, setDemoRole, signOut, demoMode, can, authenticated } =
    useSession();
  const { resetDemoData } = useAppStore();
  const router = useRouter();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  /*
   * SIGN OUT OWNS ITS OWN NAVIGATION IN REAL MODE.
   *
   * `signOut()` there ends the Supabase session and then replaces and
   * refreshes, because the router cache has to be invalidated or the previous
   * person's rendered pages stay available. Pushing here as well raced that:
   * the push could land before the session was actually ended, putting the
   * login screen up while the cookie was still valid.
   *
   * Demo mode has no server session to end, so it still needs the navigation.
   */
  const handleSignOut = () => {
    signOut();
    if (!authenticated) router.push("/login");
  };

  const handleReset = async () => {
    setResetting(true);
    await resetDemoData();
    setResetting(false);
    setResetOpen(false);
    router.refresh();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] p-2 text-left transition-colors hover:bg-hover-surface",
              collapsed && "justify-center p-1.5",
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary-soft-foreground">
              {user.avatarInitials}
            </span>
            {!collapsed ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-foreground">
                  {user.name}
                </span>
                <span className="block truncate text-[11px] text-sidebar-muted">
                  {ROLE_LABEL[role]}
                </span>
              </span>
            ) : (
              <span className="sr-only">
                {user.name} — {ROLE_LABEL[role]}
              </span>
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" side="top" className="w-64">
          <div className="px-2.5 pt-1.5 pb-2">
            <p className="truncate text-[13px] font-semibold text-foreground">
              {user.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">{scopeLabel}</p>
          </div>

          <DropdownMenuSeparator />

          {demoMode ? (
            <>
              <DropdownMenuLabel>Demo role</DropdownMenuLabel>
              <p className="px-2.5 pb-1.5 text-[11px] leading-relaxed text-subtle-foreground">
                Presentation aid — switches the active role so navigation and
                permissions change. Removed before production.
              </p>
              {DEMO_SWITCHABLE_ROLES.map((demoRole: Role) => (
                <DropdownMenuItem
                  key={demoRole}
                  onSelect={() => setDemoRole(demoRole)}
                  className="justify-between"
                >
                  <span>{ROLE_LABEL[demoRole]}</span>
                  {role === demoRole ? (
                    <Check className="size-3.5 !text-primary" aria-hidden />
                  ) : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          ) : null}

          {can("manage_users") ? (
            <DropdownMenuItem asChild>
              <Link href="/admin/users" onClick={onNavigate}>
                <UserCog />
                User management
              </Link>
            </DropdownMenuItem>
          ) : null}
          {can("manage_integrations") ? (
            <DropdownMenuItem asChild>
              <Link href="/admin/integrations" onClick={onNavigate}>
                <Settings />
                Settings & integrations
              </Link>
            </DropdownMenuItem>
          ) : null}
          {demoMode ? (
            <DropdownMenuItem onSelect={() => setResetOpen(true)}>
              <RotateCcw />
              Reset demo data
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={handleSignOut} tone="danger">
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent
          title="Reset demo data?"
          description="Clears everything stored in this browser and restores the seeded demo content."
        >
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            This removes uploaded documents, saved forms, chat history, and any
            permission changes made during the demo, then restores the original
            seeded set. Nothing outside this browser is affected.
          </p>
          <div className="mt-4">
            <Badge tone="attention">Cannot be undone</Badge>
          </div>
          <DialogActions>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleReset} disabled={resetting}>
              {resetting ? "Resetting…" : "Reset demo data"}
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </>
  );
}
