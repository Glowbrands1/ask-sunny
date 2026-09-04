"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";

import { Notice } from "@/components/ui/feedback";
import {
  DEFAULT_PERMISSION_MATRIX,
  PERMISSION_LABEL,
  ROLES,
  ROLE_LABEL,
  ROLE_SHORT_LABEL,
  hasPermission,
} from "@/lib/permissions";
import { useSession } from "@/lib/session/session-context";
import type { Permission } from "@/types";

/**
 * WHY A FORMS SCREEN DOES NOT LOCK YOU OUT IN PREVIEW.
 *
 * `PermissionGate` replaces a page with "not available for your access level".
 * That is right once somebody has decided who may do what. Nobody has: the
 * matrix behind it is this app's own guess, and it was standing between the
 * owner and a form they were trying to look at — a Salon Director refused the
 * DMIT EPP because the default list happens not to include Create EPP.
 *
 * It was also not protecting anything. The preview role comes from the browser,
 * so a refusal is a suggestion: switch role in the profile menu and it is gone.
 *
 * So in preview, Forms shows the screen and says what the permission WILL be
 * once roles are configured. The model stays visible — which is the useful part
 * — without pretending to enforce it. The server side of this decision, and the
 * line where real enforcement belongs, is in `lib/forms/access.ts`.
 */
export function FormsAccessNotice({ permission }: { permission: Permission }) {
  const { can, role, demoMode } = useSession();

  // Once identity is real the server refuses first and this component has
  // nothing to add, so it renders nothing rather than a stale reassurance.
  if (!demoMode) return null;
  if (can(permission)) return null;

  const carriedBy = ROLES.filter((entry) =>
    hasPermission(DEFAULT_PERMISSION_MATRIX, entry, permission),
  );

  return (
    <Notice tone="neutral" icon={<ShieldCheck />}>
      Not blocked, but worth knowing: <span className="text-foreground">{PERMISSION_LABEL[permission]}</span>{" "}
      is not in the default permission list for {ROLE_LABEL[role]}. Preview does not
      enforce it, because roles have not been configured yet and the preview role is
      not verified. Set who may do this in Admin → Permissions when you are ready.
      {carriedBy.length > 0 ? (
        <> Currently carried by {carriedBy.map((entry) => ROLE_SHORT_LABEL[entry]).join(", ")}.</>
      ) : null}
    </Notice>
  );
}
