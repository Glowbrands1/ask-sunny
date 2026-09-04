"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { PageShell } from "@/components/ui/layout";
import { ROLE_LABEL } from "@/lib/permissions";
import { useSession } from "@/lib/session/session-context";
import type { Permission } from "@/types";

/**
 * Client-side permission gating — the SECOND line, not the first.
 *
 * Every page now calls `requirePagePermission()` on the server before it
 * renders, so under real authentication this component is barely reachable:
 * the guard has already redirected. It stays for two cases that are still real.
 *
 * In DEMO MODE the server guards deliberately do not enforce (the demo matrix
 * is a guess, and enforcing a guess previously left screens with no way in), so
 * this is what shows a presenter what a narrower role would see.
 *
 * And it is a cheap backstop for a page that somehow lost its server guard —
 * which the page tests would catch, but a second refusal costs nothing.
 *
 * It is NOT the boundary. A client component cannot be one.
 */
export function PermissionGate({
  permission,
  adminOnly,
  children,
}: {
  permission?: Permission;
  adminOnly?: boolean;
  children: ReactNode;
}) {
  const { can, isAdmin, role, authenticated } = useSession();

  const allowed =
    (!adminOnly || isAdmin) && (!permission || can(permission));

  if (allowed) return <>{children}</>;

  return (
    <PageShell>
      <EmptyState
        icon={<Lock />}
        title="This screen is not available for your access level"
        description={
          authenticated
            ? /*
               * No mention of the demo switcher, which does not exist here and
               * would throw if it did. Telling a real person to "switch role"
               * sends them looking for a control they will never find.
               */
              `You are signed in as ${ROLE_LABEL[role]}, and this screen needs access your role does not have. Ask an administrator if you need it.`
            : `You are signed in as ${ROLE_LABEL[role]}. Ask an Owner or Administrator to adjust your permissions, or switch the demo role from the profile menu to preview it.`
        }
        action={
          /*
           * Back to a page this role can actually OPEN. "/" needs
           * `view_overview`, so offering it to somebody who was just refused
           * for lacking a permission can bounce them straight out again.
           */
          <Button asChild variant="secondary">
            <Link href={can("view_overview") ? "/" : "/chat"}>
              {can("view_overview") ? "Back to Overview" : "Back to Ask Sunny"}
            </Link>
          </Button>
        }
      />
    </PageShell>
  );
}
