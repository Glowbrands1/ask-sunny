"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Info, Lock, RotateCcw, Save, Undo2 } from "lucide-react";

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
  ROLES,
  effectiveMatrix,
  isPermissionEditableFor,
  isPermissionLockedFor,
  overridesFromMatrix,
  sanitizeOverrides,
  togglePermission,
} from "@/lib/permissions";
import { useAppStore } from "@/lib/store/app-store";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils/cn";
import type { Permission, PermissionMatrix, Role } from "@/types";

/**
 * ============================================================================
 * Roles x features matrix. SAVED TO THE DATABASE AND ENFORCED ON THE SERVER.
 * ============================================================================
 *
 * (Pau, 23 Nov 2026.) This screen used to show the policy and refuse to change
 * it once authentication was real, because a saved matrix nobody enforced would
 * have been worse than none. It is enforced now: Save writes
 * `permission_overrides` through PUT /api/admin/permissions, and the server's
 * `authorizeRequest` / `requirePagePermission` and the browser's `can()` all read
 * the same merged matrix, so what this screen shows after a refresh is exactly
 * what is enforced. The grid is always loaded from the server — never from
 * this browser's copy — and is re-read after every save.
 *
 * ONE TICK = ONE CHANGE IN A DRAFT. Nothing is sent until "Save changes";
 * "Discard" returns to what is saved; "Reset to defaults" puts the built-in
 * defaults in the draft (still needs Save). In demo mode the same screen edits
 * the browser's own store copy, as before.
 *
 * Cells that cannot change stay locked with the reason on hover: the
 * administrator roles (always full access), `manage_users`,
 * `manage_integrations`, L10, and the administrator-only reports for any role
 * that does not hold them by default. The server refuses them as well.
 */

type LoadState = "loading" | "ready" | "error";

/** The matrix the server enforces right now, or null if it could not be read. */
async function fetchEnforcedMatrix(): Promise<PermissionMatrix | null> {
  try {
    const response = await fetch("/api/admin/permissions", { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { overrides?: unknown };
    return effectiveMatrix(sanitizeOverrides(body.overrides ?? {}));
  } catch {
    return null;
  }
}

function sameCell(a: PermissionMatrix, b: PermissionMatrix, role: Role, permission: Permission) {
  return (a[role]?.includes(permission) ?? false) === (b[role]?.includes(permission) ?? false);
}

function lockedReason(role: Role, permission: Permission): string {
  if (canAccessAdminConsole(role)) return "Administrators always hold every permission.";
  if (isPermissionLockedFor(role, permission)) {
    return `Administrative permissions are restricted to ${ADMIN_CONSOLE_ROLES.map((entry) => ROLE_LABEL[entry]).join(", ")}.`;
  }
  return "This is an administrator-only report. It can be taken away from a role that has it, but not given to one that does not.";
}

export function PermissionsMatrix() {
  const { permissionMatrix, setPermissionMatrix } = useAppStore();
  const { authenticated, refreshPermissions } = useSession();

  /*
   * `saved` is what is IN FORCE: the server's matrix in real mode, the store's
   * copy in demo. `draft` is what the screen shows and edits.
   */
  const [saved, setSaved] = useState<PermissionMatrix>(authenticated ? DEFAULT_PERMISSION_MATRIX : permissionMatrix);
  const [defaults, setDefaults] = useState<PermissionMatrix>(DEFAULT_PERMISSION_MATRIX);
  const [draft, setDraft] = useState<PermissionMatrix>(saved);
  const [state, setState] = useState<LoadState>(authenticated ? "loading" : "ready");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const applyLoaded = useCallback((matrix: PermissionMatrix | null) => {
    if (!matrix) {
      setState("error");
      return;
    }
    setSaved(matrix);
    setDraft(matrix);
    setDefaults(DEFAULT_PERMISSION_MATRIX);
    setState("ready");
  }, []);

  // The retry button. The first load is the effect below, which does not set state until the answer is in.
  const retry = useCallback(() => {
    setState("loading");
    void fetchEnforcedMatrix().then(applyLoaded);
  }, [applyLoaded]);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    void fetchEnforcedMatrix().then((matrix) => {
      if (!cancelled) applyLoaded(matrix);
    });
    return () => {
      cancelled = true;
    };
  }, [authenticated, applyLoaded]);

  const changed = useMemo(() => {
    const cells = new Set<string>();
    for (const role of ROLES) {
      for (const permission of PERMISSIONS) {
        if (!sameCell(draft, saved, role, permission)) cells.add(`${role}:${permission}`);
      }
    }
    return cells;
  }, [draft, saved]);
  const atDefaults = useMemo(
    () => ROLES.every((role) => PERMISSIONS.every((permission) => sameCell(draft, defaults, role, permission))),
    [draft, defaults],
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

  const editing = state === "ready" && !saving;

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      if (!authenticated) {
        setPermissionMatrix(draft);
        setSaved(draft);
        setNotice({ tone: "ok", text: "Saved in this browser's demo." });
        return;
      }
      const response = await fetch("/api/admin/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: overridesFromMatrix(draft) }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; overrides?: unknown };
      if (!response.ok) {
        setNotice({ tone: "error", text: body.error ?? "The permissions could not be saved. Nothing was changed." });
        return;
      }
      // Show what the server now enforces, not what was ticked.
      const matrix = effectiveMatrix(sanitizeOverrides(body.overrides ?? {}));
      setSaved(matrix);
      setDraft(matrix);
      await refreshPermissions?.();
      setNotice({
        tone: "ok",
        text: "Saved. These permissions are now in force. People who are signed in get them on their next page or action.",
      });
    } catch {
      setNotice({ tone: "error", text: "The permissions could not be saved. Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  const count = changed.size;

  return (
    <div>
      <SectionHeader
        title="Permissions"
        description="What each access level can see and do. Tick a box to give a role something, untick it to take it away, then press Save changes."
      />

      {authenticated && state === "error" ? (
        <Notice
          tone="attention"
          className="mb-4"
          title="The saved permissions could not be loaded"
          action={
            <Button size="sm" variant="ghost" onClick={retry}>
              Try again
            </Button>
          }
        >
          Editing is switched off so nothing is saved over a policy this screen has not seen.
        </Notice>
      ) : null}

      {notice ? (
        <Notice
          tone={notice.tone === "ok" ? "primary" : "attention"}
          icon={notice.tone === "ok" ? <CheckCircle2 /> : <Info />}
          className="mb-4"
        >
          <span role={notice.tone === "ok" ? "status" : "alert"}>{notice.text}</span>
        </Notice>
      ) : null}

      <Notice tone="neutral" icon={<Lock />} className="mb-4">
        Admin console access is fixed to{" "}
        {ADMIN_CONSOLE_ROLES.map((role) => ROLE_LABEL[role]).join(" and ")} and
        cannot be granted here. Locked cells explain why on hover.
      </Notice>

      <ScrollTable>
        <table className="w-full min-w-[60rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th
                scope="col"
                className="sticky left-0 z-10 bg-surface px-4 py-3 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase"
              >
                Feature
              </th>
              {ROLES.map((role) => (
                <th
                  key={role}
                  scope="col"
                  className="w-24 px-2 py-3 text-center align-bottom text-[12px] leading-tight font-semibold text-foreground"
                >
                  {ROLE_LABEL[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, permissions]) => (
              <Fragment key={group}>
                <tr className="border-b border-border">
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
                    className="group/row border-b border-border transition-colors last:border-0 hover:bg-surface-muted/50"
                  >
                    <th
                      scope="row"
                      className="sticky left-0 bg-surface px-4 py-2.5 text-left text-[13px] font-normal text-foreground group-hover/row:bg-surface-muted"
                    >
                      {PERMISSION_LABEL[permission]}
                    </th>
                    {ROLES.map((role) => {
                      const administrative = canAccessAdminConsole(role);
                      const editable = isPermissionEditableFor(role, permission);
                      const checked = administrative ? true : (draft[role]?.includes(permission) ?? false);
                      const edited = changed.has(`${role}:${permission}`);
                      const cellId = `perm-${role}-${permission}`;
                      const disabled = !editable || !editing;

                      const control = (
                        /*
                         * THE WHOLE CELL IS THE TARGET: the label fills it, so a
                         * click anywhere in the cell toggles the box, and it is
                         * tall enough (44px) to hit on a tablet.
                         */
                        <label
                          htmlFor={cellId}
                          className={cn(
                            "flex min-h-11 items-center justify-center",
                            editable && editing ? "cursor-pointer" : "cursor-default",
                          )}
                        >
                          <Checkbox
                            id={cellId}
                            checked={checked}
                            disabled={disabled}
                            aria-label={`${PERMISSION_LABEL[permission]} for ${ROLE_LABEL[role]}`}
                            className="size-6"
                            onCheckedChange={() =>
                              setDraft((current) => togglePermission(current, role, permission))
                            }
                          />
                        </label>
                      );

                      return (
                        <td
                          key={cellId}
                          data-changed={edited ? "true" : undefined}
                          className={cn(
                            "p-0 transition-colors",
                            !editable && "bg-surface-muted/60",
                            editable && editing && "hover:bg-primary-soft",
                            edited && "bg-status-attention-bg",
                          )}
                        >
                          {editable ? (
                            control
                          ) : (
                            <Tooltip content={lockedReason(role, permission)}>{control}</Tooltip>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </ScrollTable>

      {/* Always in view while there is something to save, so Save is never scrolled away. */}
      <div
        className="sticky bottom-4 z-20 mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3 shadow-float"
        data-testid="permissions-save-bar"
      >
        <p className="mr-auto text-[13px] text-foreground" aria-live="polite">
          {count > 0
            ? `${count} unsaved ${count === 1 ? "change" : "changes"}`
            : "No unsaved changes"}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={!editing || atDefaults}
          onClick={() => {
            setDraft(defaults);
            setNotice(null);
          }}
        >
          <RotateCcw />
          Reset to defaults
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!editing || count === 0}
          onClick={() => {
            setDraft(saved);
            setNotice(null);
          }}
        >
          <Undo2 />
          Discard
        </Button>
        <Button size="sm" disabled={!editing || count === 0} onClick={() => void save()}>
          <Save />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <Notice tone="neutral" icon={<Info />} className="mt-4">
        {authenticated
          ? "Saved permissions are enforced on the server: every page checks before it renders and every API route checks before it acts. Navigation hides what a role cannot open, but hiding is not what stops it. Changes reach every server within about ten seconds."
          : "In demo mode permissions gate navigation and page content on the client, which is right for a demo but is not security. With authentication configured, the same permission keys gate the route on the server. Switch the demo role in the profile menu to see these take effect."}
      </Notice>
    </div>
  );
}
