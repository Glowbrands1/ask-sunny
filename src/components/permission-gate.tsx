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
 * Client-side permission gating.
 *
 * This is the demo's enforcement: navigation hides what a role cannot reach,
 * and this component blocks the page itself if someone lands on the URL
 * directly. It is NOT security — there is no auth middleware in this phase.
 * In production the same permission keys gate the route on the server.
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
  const { can, isAdmin, role } = useSession();

  const allowed =
    (!adminOnly || isAdmin) && (!permission || can(permission));

  if (allowed) return <>{children}</>;

  return (
    <PageShell>
      <EmptyState
        icon={<Lock />}
        title="This screen is not available for your access level"
        description={`You are signed in as ${ROLE_LABEL[role]}. Ask an Owner or Administrator to adjust your permissions, or switch the demo role from the profile menu to preview it.`}
        action={
          <Button asChild variant="secondary">
            <Link href="/">Back to Overview</Link>
          </Button>
        }
      />
    </PageShell>
  );
}
