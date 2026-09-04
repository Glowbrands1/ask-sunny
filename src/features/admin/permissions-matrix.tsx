"use client";

import { useMemo, useState } from "react";
import { Eye, Info, Lock, RotateCcw, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { ScrollTable, SectionHeader } from "@/components/ui/layout";
import { Tooltip } from "@/components/ui/overlays";
import {
  ADMIN_CONSOLE_ROLES,
  canAccessAdminConsole,
  DEFAULT_PERMISSION_MATRIX,
  PERMISSION_GROUP,
  PERMISSION_LABEL,
  PERMISSIONS,
  ROLE_LABEL,
  ROLE_SHORT_LABEL,
  ROLES,
  isPermissionLockedFor,
  togglePermission,
} from "@/lib/permissions";
import { useAppStore } from "@/lib/store/app-store";
import { useSession } from "@/lib/session/session-context";
import { nowIso } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import type { PermissionMatrix } from "@/types";

/**
 * ============================================================================
 * Roles x features matrix. READ-ONLY once authentication is real.
 * ============================================================================
 *
 * With real authentication configured this screen SHOWS the policy and cannot
 * change it, and that is a deliberate scope decision rather than a missing
 * feature. Editing it for real means persisting a matrix, versioning it,
 * auditing every change, and — the part that makes it a project rather than a
 * checkbox — deciding what happens to somebody signed in under the old policy.
 * A half-built version of that is worse than none: an administrator would tick
 * a box, see it saved, and get no change in behaviour anywhere.
 *
 * So the editable version stays exactly where it belongs — demo mode, where
 * the matrix lives in this browser's IndexedDB and changing it is how a
 * presenter shows what a role can do. In real mode `can()` reads
 * DEFAULT_PERMISSION_MATRIX on both the client and the server, so an edited
 * local copy would grant nothing anyway; rendering Save would be offering a
 * control that does nothing.
 *
 * Cells for the administrative roles are locked ON — that access is fixed and
 * is not a policy choice. `manage_users` and `manage_integrations` are locked
 * OFF for every other role, for the same reason.
 */
export function PermissionsMatrix() {
  const { permissionMatrix, setPermissionMatrix } = useAppStore();
  const { authenticated } = useSession();
  /*
   * In real mode the DISPLAYED matrix is the server's, not the store's. Showing
   * a locally-edited copy here would describe an access policy that no longer
   * matches what anybody actually gets.
   */
  const source = authenticated ? DEFAULT_PERMISSION_MATRIX : permissionMatrix;
  const [draft, setDraft] = useState<PermissionMatrix>(source);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(source),
    [draft, source],
  );

  const groups = useMemo(() => {
    const map = new Map<string, typeof PERMISSIONS>();
    PERMISSIONS.forEach((permission) => {
      const group = PERMISSION_GROUP[permission];
      const list = map.get(group) ?? [];
      list.push(permission);
      map.set(group, list);
    });
    return Array.from(map.entries());
  }, []);

  return (
    <div>
      <SectionHeader
        title="Permissions"
        description="What each access level can see and do. Changes apply immediately across navigation and every screen."
        actions={
          authenticated ? null : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft(DEFAULT_PERMISSION_MATRIX)}
              >
                <RotateCcw />
                Reset to defaults
              </Button>
              <Button
                size="sm"
                disabled={!dirty}
                onClick={() => {
                  setPermissionMatrix(draft);
                  setSavedAt(nowIso());
                }}
              >
                <Save />
                Save changes
              </Button>
            </>
          )
        }
      />

      {authenticated ? (
        <Notice tone="neutral" icon={<Eye />} className="mb-4" title="This is the current policy, shown for reference">
          Roles are assigned per person in the Team tab. The policy itself —
          which role can do what — is fixed in this release and is enforced on
          the server for every request, so it cannot be changed from a browser.
        </Notice>
      ) : null}

      <Notice tone="neutral" icon={<Lock />} className="mb-4">
        Admin console access is fixed to{" "}
        {ADMIN_CONSOLE_ROLES.map((role) => ROLE_LABEL[role]).join(" and ")} and
        cannot be granted here. Locked cells explain why on hover.
      </Notice>

      <ScrollTable>
        <table className="w-full min-w-[54rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th
                scope="col"
                className="sticky left-0 bg-surface px-4 py-3 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase"
              >
                Feature
              </th>
              {ROLES.map((role) => (
                <th
                  key={role}
                  scope="col"
                  className="px-3 py-3 text-center text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
                >
                  <Tooltip content={ROLE_LABEL[role]}>
                    <span className="cursor-help">{ROLE_SHORT_LABEL[role]}</span>
                  </Tooltip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, permissions]) => (
              <>
                <tr key={`group-${group}`} className="border-b border-border">
                  <th
                    scope="colgroup"
                    colSpan={ROLES.length + 1}
                    className="sticky left-0 bg-surface-muted px-4 py-2 text-left text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase"
                  >
                    {group}
                  </th>
                </tr>
                {permissions.map((permission) => (
                  <tr
                    key={permission}
                    className="border-b border-border last:border-0"
                  >
                    <th
                      scope="row"
                      className="sticky left-0 bg-surface px-4 py-2.5 text-left text-[13px] font-normal text-foreground"
                    >
                      {PERMISSION_LABEL[permission]}
                    </th>
                    {ROLES.map((role) => {
                      const administrative = canAccessAdminConsole(role);
                      const locked = isPermissionLockedFor(role, permission);
                      /*
                       * THE SECOND HALF OF THE SAME BUG. Both this and
                       * `isPermissionLockedFor` tested `owner || developer`, and
                       * both were left behind when `admin` was added — so
                       * fixing only one made it worse, not better: the client
                       * administrator became "locked" and every cell in their
                       * column then rendered UNCHECKED. Asking
                       * `canAccessAdminConsole` in both places is what keeps
                       * the two halves from ever disagreeing again.
                       */
                      const checked = administrative
                        ? true
                        : locked
                          ? false
                          : (draft[role]?.includes(permission) ?? false);
                      const cellId = `perm-${role}-${permission}`;

                      const control = (
                        <span className="flex justify-center">
                          <Checkbox
                            id={cellId}
                            checked={checked}
                            disabled={locked || authenticated}
                            aria-label={`${PERMISSION_LABEL[permission]} for ${ROLE_LABEL[role]}`}
                            onCheckedChange={() =>
                              setDraft((current) =>
                                togglePermission(current, role, permission),
                              )
                            }
                          />
                        </span>
                      );

                      return (
                        <td
                          key={cellId}
                          className={cn(
                            "px-3 py-2.5",
                            locked && "bg-surface-muted/60",
                          )}
                        >
                          {locked ? (
                            <Tooltip
                              content={
                                administrative
                                  ? "Administrators always hold every permission."
                                  : `Administrative permissions are restricted to ${ADMIN_CONSOLE_ROLES.map(
                                      (entry) => ROLE_LABEL[entry],
                                    ).join(", ")}.`
                              }
                            >
                              {control}
                            </Tooltip>
                          ) : (
                            control
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </ScrollTable>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {dirty ? (
          <Badge tone="attention">Unsaved changes</Badge>
        ) : savedAt ? (
          <Badge tone="ready">Saved</Badge>
        ) : null}
        {authenticated ? null : (
          <p className="text-xs text-muted-foreground">
            Switch the demo role in the profile menu to see these permissions
            take effect in navigation.
          </p>
        )}
      </div>

      {/*
        BOTH SENTENCES WERE TRUE WHEN WRITTEN AND ONE OF THEM IS NOW WRONG.
        Permissions no longer gate only the client: every page calls
        `requirePagePermission()` on the server before it renders, and every API
        route calls `authorizeRequest()`. Saying otherwise on the permissions
        screen would understate the protection that actually exists — and the
        demo wording still has to be right for demo mode, where it is accurate.
      */}
      <Notice tone="neutral" icon={<Info />} className="mt-4">
        {authenticated
          ? "These permissions are enforced on the server: every page checks before it renders and every API route checks before it acts. Navigation hides what a role cannot open, but hiding is not what stops it."
          : "In demo mode permissions gate navigation and page content on the client, which is right for a demo but is not security. With authentication configured, the same permission keys gate the route on the server."}
      </Notice>
    </div>
  );
}
