"use client";

import { useMemo, useState } from "react";
import { Info, Lock, RotateCcw, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { ScrollTable, SectionHeader } from "@/components/ui/layout";
import { Tooltip } from "@/components/ui/overlays";
import {
  ADMIN_CONSOLE_ROLES,
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
import { nowIso } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import type { PermissionMatrix } from "@/types";

/**
 * Roles x features matrix.
 *
 * Cells for admin-console roles (Owner, Developer) are locked on — admin
 * console access is fixed and is not editable here. `manage_users` and
 * `manage_integrations` are likewise locked off for non-admin roles.
 */
export function PermissionsMatrix() {
  const { permissionMatrix, setPermissionMatrix } = useAppStore();
  const [draft, setDraft] = useState<PermissionMatrix>(permissionMatrix);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(permissionMatrix),
    [draft, permissionMatrix],
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
        }
      />

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
                      const locked = isPermissionLockedFor(role, permission);
                      const checked =
                        locked && (role === "owner" || role === "developer")
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
                            disabled={locked}
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
                                role === "owner" || role === "developer"
                                  ? "Owners and administrators always hold every permission."
                                  : "Administrative permissions are restricted to Owner and Developer."
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
        <p className="text-xs text-muted-foreground">
          Switch the demo role in the profile menu to see these permissions take
          effect in navigation.
        </p>
      </div>

      <Notice tone="neutral" icon={<Info />} className="mt-4">
        In this prototype permissions gate navigation and page content on the
        client, which is right for a demo but is not security. In production the
        same permission keys gate the route on the server.
      </Notice>
    </div>
  );
}
