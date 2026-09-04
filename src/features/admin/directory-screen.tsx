"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  MailCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup, Input, Select } from "@/components/ui/field";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { ScrollTable, SectionHeader } from "@/components/ui/layout";
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
} from "@/components/ui/overlays";
import { DEMO_DISTRICTS, DEMO_LOCATIONS, DEMO_REGIONS } from "@/data/demo/locations";
import { ADMIN_CONSOLE_ROLES, ROLE_DESCRIPTION, ROLE_LABEL, ROLES } from "@/lib/permissions";
import { useSession } from "@/lib/session/session-context";
import { relativeTime } from "@/lib/utils/date";
import type { AccessScope, Role, ScopeLevel } from "@/types";

/**
 * ============================================================================
 * THE REAL USER DIRECTORY.
 * ============================================================================
 *
 * Reads and writes `/api/admin/users`, which is authorized server-side against
 * a verified identity. Nothing on this screen is trusted to be a boundary: the
 * disabled buttons and hidden options below are there so an administrator is
 * not offered an action that will fail, and every one of them is enforced again
 * on the server whether or not this component behaves.
 *
 * ============================================================================
 * WHAT THIS SCREEN CANNOT DO, BY DESIGN
 * ============================================================================
 *
 * It cannot set, show, generate or email a password. "Send sign-in link" asks
 * the server to have SUPABASE mail the person a link they use themselves; the
 * link never comes back here, so there is nothing for this screen to display
 * even if somebody asked it to. That is why there is no "copy link" button and
 * no password field anywhere below.
 *
 * It cannot change an email address either. The address is the credential's
 * identity, so changing it in the profile alone would silently break sign-in —
 * which looks like an app bug rather than an edit.
 */

export interface DirectoryUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: "invited" | "active" | "disabled";
  scope: AccessScope;
  createdAt: string;
  updatedAt: string;
}

/** Uses the shared badge tones so status reads the same as it does elsewhere. */
const STATUS_TONE: Record<DirectoryUser["status"], "ready" | "processing" | "neutral"> = {
  active: "ready",
  invited: "processing",
  disabled: "neutral",
};

const STATUS_LABEL: Record<DirectoryUser["status"], string> = {
  active: "Active",
  invited: "Invited",
  disabled: "Disabled",
};

/** Areas an administrator can pick, by scope level. */
const AREAS: Record<Exclude<ScopeLevel, "global">, { id: string; name: string }[]> = {
  salon: DEMO_LOCATIONS.map((entry) => ({ id: entry.id, name: entry.name })),
  district: DEMO_DISTRICTS.map((entry) => ({ id: entry.id, name: entry.name })),
  region: DEMO_REGIONS.map((entry) => ({ id: entry.id, name: entry.name })),
};

function areaName(scope: AccessScope): string {
  if (scope.level === "global") return "All salons";
  if (!scope.primaryAreaId) return "—";
  const list = AREAS[scope.level];
  return list.find((entry) => entry.id === scope.primaryAreaId)?.name ?? scope.primaryAreaId;
}

export function DirectoryScreen({
  /**
   * The directory as the SERVER read it for this request.
   *
   * Passed in rather than fetched on mount. The page already required
   * `manage_users` before rendering, so the same request that proved the caller
   * may see this list also read it: the first paint is the real thing, there is
   * no second round trip, and there is no mount effect to cascade renders.
   */
  initialUsers,
  loadError: initialLoadError = null,
}: {
  initialUsers: DirectoryUser[];
  loadError?: string | null;
}) {
  const { user: me } = useSession();

  const [users, setUsers] = useState<DirectoryUser[]>(initialUsers);
  const [loadError, setLoadError] = useState<string | null>(initialLoadError);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  /*
   * The error is cleared when an ANSWER arrives, not when a request starts.
   *
   * Clearing it first read better — the banner disappears the moment you press
   * Refresh — but it is a synchronous setState in the mount effect, which
   * cascades a render before the fetch has even been issued. Clearing on the
   * response is also more honest: while the request is in flight, the last
   * thing we actually know is still that the previous one failed.
   */
  /**
   * Re-reads the directory. Called from the Refresh button and after nothing
   * else — a user action, never a render.
   *
   * On failure the CURRENT list is kept rather than replaced with an empty one.
   * Blanking an administration screen because one refresh failed is worse than
   * showing a slightly stale list beside a message saying so.
   */
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setLoadError(
          (payload as { error?: string } | null)?.error ??
            "The user list could not be refreshed.",
        );
        return;
      }
      setLoadError(null);
      setUsers((payload as { users: DirectoryUser[] }).users);
    } catch {
      setLoadError("The user list could not be refreshed. Check your connection and try again.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users
      .filter((entry) => (roleFilter === "all" ? true : entry.role === roleFilter))
      .filter((entry) => {
        if (!needle) return true;
        return (
          entry.displayName.toLowerCase().includes(needle) ||
          entry.email.toLowerCase().includes(needle) ||
          ROLE_LABEL[entry.role].toLowerCase().includes(needle)
        );
      });
  }, [users, query, roleFilter]);

  /**
   * How many ACTIVE administrators there are, counted from what is on screen.
   *
   * Used only to disable a control before it is clicked. The refusal itself
   * lives in the API and in a database trigger, counted there against the whole
   * table — this count would be wrong the moment somebody else made a change,
   * and it is not allowed to be the thing that protects the last administrator.
   */
  const activeAdmins = useMemo(
    () =>
      users.filter(
        (entry) =>
          entry.status === "active" &&
          (ADMIN_CONSOLE_ROLES as readonly string[]).includes(entry.role),
      ).length,
    [users],
  );

  async function send(
    id: string,
    body: Record<string, unknown> | null,
    path = "",
  ): Promise<boolean> {
    setBusyId(id);
    setActionError(null);
    setActionNote(null);
    try {
      const response = await fetch(`/api/admin/users/${id}${path}`, {
        method: body ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setActionError(
          (payload as { error?: string } | null)?.error ?? "That change could not be saved.",
        );
        return false;
      }

      const updated = (payload as { user?: DirectoryUser }).user;
      if (updated) {
        setUsers((current) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry)),
        );
      }
      const sent = (payload as { sent?: string; email?: string }).sent;
      if (sent) {
        setActionNote(
          sent === "invitation"
            ? `A new invitation is on its way to ${(payload as { email: string }).email}.`
            : `A password reset link is on its way to ${(payload as { email: string }).email}.`,
        );
      }
      return true;
    } catch {
      setActionError("That change could not be saved. Check your connection and try again.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      {loadError ? (
        <Notice tone="attention" title="The directory is unavailable">
          {loadError}
        </Notice>
      ) : null}
      {actionError ? (
        <Notice tone="attention" title="That did not work">
          {actionError}
        </Notice>
      ) : null}
      {actionNote ? (
        <Notice tone="accent" icon={<MailCheck />}>
          {actionNote}
        </Notice>
      ) : null}

      <SectionHeader
        title="Team"
        description="Every person with an Ask Sunny login. Roles and access are read from the server on every request — nothing here is decided in the browser."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={refreshing}
              onClick={() => void load()}
            >
              {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Refresh
            </Button>
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus />
              Invite someone
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <FieldGroup label="Search" htmlFor="directory-search" className="min-w-56 flex-1">
              <Input
                id="directory-search"
                type="search"
                placeholder="Name, email or role"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </FieldGroup>
            <FieldGroup label="Role" htmlFor="directory-role" className="min-w-48">
              <Select
                id="directory-role"
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value as Role | "all")}
              >
                <option value="all">All roles</option>
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
              </Select>
            </FieldGroup>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Search />}
              title={users.length === 0 ? "No accounts yet" : "Nobody matches that"}
              description={
                users.length === 0
                  ? "No Ask Sunny accounts exist yet. Invite the first person to get started."
                  : "Try a different name, email or role."
              }
            />
          ) : (
            <ScrollTable>
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] tracking-wide text-muted-foreground uppercase">
                    <th className="py-2 pr-3 font-semibold">Person</th>
                    <th className="py-2 pr-3 font-semibold">Role</th>
                    <th className="py-2 pr-3 font-semibold">Scope</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 pr-3 font-semibold">Updated</th>
                    <th className="py-2 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => {
                    const isMe = entry.id === me.id;
                    const isAdministrative = (ADMIN_CONSOLE_ROLES as readonly string[]).includes(
                      entry.role,
                    );
                    /*
                     * Disabled when this is the last active administrator, so a
                     * change that the server would refuse is not offered. The
                     * server refuses it anyway — see `activeAdmins`.
                     */
                    const isLastAdmin =
                      isAdministrative && entry.status === "active" && activeAdmins <= 1;
                    const busy = busyId === entry.id;

                    return (
                      <tr key={entry.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2.5 pr-3">
                          <span className="block font-medium text-foreground">
                            {entry.displayName}
                            {isMe ? (
                              <Badge tone="neutral" size="sm" className="ml-2">
                                You
                              </Badge>
                            ) : null}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {entry.email}
                          </span>
                        </td>

                        <td className="py-2.5 pr-3">
                          <Select
                            aria-label={`Role for ${entry.displayName}`}
                            value={entry.role}
                            disabled={busy || isMe || isLastAdmin}
                            onChange={(event) =>
                              void send(entry.id, { role: event.target.value })
                            }
                          >
                            {ROLES.map((role) => (
                              <option key={role} value={role}>
                                {ROLE_LABEL[role]}
                              </option>
                            ))}
                          </Select>
                        </td>

                        <td className="py-2.5 pr-3 text-muted-foreground">
                          <span className="block">{areaName(entry.scope)}</span>
                          <span className="block text-xs capitalize">{entry.scope.level}</span>
                        </td>

                        <td className="py-2.5 pr-3">
                          <Badge tone={STATUS_TONE[entry.status]} size="sm">
                            {STATUS_LABEL[entry.status]}
                          </Badge>
                        </td>

                        <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                          {entry.updatedAt ? relativeTime(entry.updatedAt) : "—"}
                        </td>

                        <td className="py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy || entry.status === "disabled"}
                              onClick={() => void send(entry.id, null, "/recovery")}
                            >
                              {busy ? <Loader2 className="animate-spin" /> : <MailCheck />}
                              {entry.status === "invited" ? "Resend invite" : "Send sign-in link"}
                            </Button>

                            {entry.status === "disabled" ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={busy}
                                onClick={() => void send(entry.id, { status: "active" })}
                              >
                                Re-enable
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                disabled={busy || isMe || isLastAdmin}
                                onClick={() => void send(entry.id, { status: "disabled" })}
                              >
                                Disable
                              </Button>
                            )}
                          </div>
                          {isLastAdmin ? (
                            <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                              <AlertTriangle className="size-3 shrink-0" aria-hidden />
                              Last administrator — give somebody else admin access first.
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollTable>
          )}
        </CardContent>
      </Card>

      <Notice tone="neutral" icon={<ShieldCheck />} title="Ask Sunny never handles passwords">
        Passwords are held by Supabase Auth. Nobody here — including an
        administrator — can read, set or email one. &ldquo;Send sign-in
        link&rdquo; asks Supabase to email the person a single-use link they use
        themselves; the link is never shown on this screen.
      </Notice>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={(user) => {
          setUsers((current) => [...current, user]);
          setActionNote(`An invitation is on its way to ${user.email}.`);
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- invite -- */

function InviteDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: (user: DirectoryUser) => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  /*
   * Employee is the default, deliberately. The least-privileged role is the
   * safe thing to click past, and an invitation sent with the wrong role is
   * only recoverable by noticing it.
   */
  const [role, setRole] = useState<Role>("employee");
  const [level, setLevel] = useState<ScopeLevel>("salon");
  const [areaId, setAreaId] = useState<string>(AREAS.salon[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          displayName,
          role,
          scope: {
            level,
            primaryAreaId: level === "global" ? null : areaId,
            alsoCoversAreaIds: [],
          },
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          (payload as { error?: string } | null)?.error ?? "The invitation could not be sent.",
        );
        setBusy(false);
        return;
      }

      onInvited((payload as { user: DirectoryUser }).user);
      setEmail("");
      setDisplayName("");
      onOpenChange(false);
    } catch {
      setError("The invitation could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Invite someone to Ask Sunny"
        description="They receive an email with a link to set their own password. No password is created here."
      >
        <form onSubmit={submit} className="space-y-4">
          {error ? (
            <Notice tone="attention" title="Could not invite">
              {error}
            </Notice>
          ) : null}

          <FieldGroup label="Work email" htmlFor="invite-email">
            <Input
              id="invite-email"
              type="email"
              required
              autoComplete="off"
              placeholder="name@suntancity.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
          </FieldGroup>

          <FieldGroup label="Full name" htmlFor="invite-name">
            <Input
              id="invite-name"
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={busy}
            />
          </FieldGroup>

          <FieldGroup label="Role" htmlFor="invite-role">
            <Select
              id="invite-role"
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
              disabled={busy}
            >
              {ROLES.map((entry) => (
                <option key={entry} value={entry}>
                  {ROLE_LABEL[entry]}
                </option>
              ))}
            </Select>
          </FieldGroup>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {ROLE_DESCRIPTION[role]}
          </p>

          <FieldGroup label="Scope" htmlFor="invite-scope">
            <Select
              id="invite-scope"
              value={level}
              onChange={(event) => {
                const next = event.target.value as ScopeLevel;
                setLevel(next);
                if (next !== "global") setAreaId(AREAS[next][0]?.id ?? "");
              }}
              disabled={busy}
            >
              <option value="salon">One salon</option>
              <option value="district">A district</option>
              <option value="region">A region</option>
              <option value="global">Everything</option>
            </Select>
          </FieldGroup>

          {level !== "global" ? (
            <FieldGroup label="Primary area" htmlFor="invite-area">
              <Select
                id="invite-area"
                value={areaId}
                onChange={(event) => setAreaId(event.target.value)}
                disabled={busy}
              >
                {AREAS[level].map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </Select>
            </FieldGroup>
          ) : null}

          <DialogActions>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !email || !displayName}>
              {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
              {busy ? "Sending…" : "Send invitation"}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
