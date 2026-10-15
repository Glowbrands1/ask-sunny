"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Copy,
  KeyRound,
  Loader2,
  MailCheck,
  MapPin,
  RefreshCw,
  RotateCcwKey,
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
import { MultiSelect } from "@/components/ui/multi-select";
import {
  PRODUCTION_DISTRICTS,
  PRODUCTION_REGIONS,
  PRODUCTION_SALONS,
  areaLabel,
} from "@/data/salons";
import {
  additionalLocationOptions,
  cleanAdditionalLocations,
} from "@/lib/admin/additional-locations";
import type { InviteSuggestion } from "@/lib/employees/woven/invite-suggestion";
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
  salon: PRODUCTION_SALONS.map((entry) => ({ id: entry.id, name: entry.name })),
  district: PRODUCTION_DISTRICTS.map((entry) => ({ id: entry.id, name: entry.name })),
  region: PRODUCTION_REGIONS.map((entry) => ({ id: entry.id, name: entry.name })),
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
  const [locationsFor, setLocationsFor] = useState<DirectoryUser | null>(null);
  /*
   * A generated reset link. A CREDENTIAL: held only while its dialog is open
   * and dropped the moment it closes. Never persisted, never logged.
   */
  const [resetLink, setResetLink] = useState<{ email: string; url: string } | null>(null);

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

  /**
   * Clears the password and every session, then emails the person a link to
   * choose their own. For accounts whose password somebody else set. Asks
   * first: the person is signed out everywhere until they follow the email.
   */
  async function resetCredentials(id: string, email: string): Promise<void> {
    if (
      !window.confirm(
        `Reset credentials for ${email}?\n\nTheir current password stops working and they are signed out everywhere. ` +
          "They choose a new password from the email Supabase sends them.",
      )
    ) {
      return;
    }
    setBusyId(id);
    setActionError(null);
    setActionNote(null);
    try {
      const response = await fetch(`/api/admin/users/${id}/credentials`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; email?: string; sessionsEnded?: number }
        | null;
      if (!response.ok) {
        setActionError(payload?.error ?? "The credentials could not be reset.");
        return;
      }
      const ended = payload?.sessionsEnded ?? 0;
      setActionNote(
        `Password cleared and ${ended} session${ended === 1 ? "" : "s"} ended. A link to choose a new password is on its way to ${payload?.email ?? email}.`,
      );
    } catch {
      setActionError("The credentials could not be reset. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Asks the server for a reset link. No body: the server looks the person up
   * by id and never accepts an address from here.
   */
  async function generateResetLink(id: string): Promise<void> {
    setBusyId(id);
    setActionError(null);
    setActionNote(null);
    try {
      const response = await fetch(`/api/admin/users/${id}/reset-link`, {
        method: "POST",
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      const url = (payload as { url?: unknown } | null)?.url;
      const email = (payload as { email?: unknown } | null)?.email;

      if (!response.ok || typeof url !== "string" || typeof email !== "string") {
        setActionError(
          (payload as { error?: string } | null)?.error ??
            "The reset link could not be generated.",
        );
        return;
      }
      setResetLink({ email, url });
    } catch {
      setActionError("The reset link could not be generated. Check your connection and try again.");
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
                          {entry.scope.alsoCoversAreaIds.length > 0 ? (
                            <span className="mt-1 block text-xs text-subtle-foreground">
                              Also: {entry.scope.alsoCoversAreaIds.map((id) => areaLabel(id)).join(", ")}
                            </span>
                          ) : null}
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
                              {/*
                                ONE LABEL FOR BOTH. It used to say "Resend
                                invite" for an invited profile, which the server
                                no longer guarantees: whether an invitation or a
                                reset goes out is decided from the CREDENTIAL's
                                confirmation state, not the profile's status, so
                                an invited-but-confirmed account correctly gets
                                a reset. The notice after the click says which
                                was actually sent; the button no longer predicts
                                it wrongly.
                              */}
                              Send sign-in link
                            </Button>

                            {/*
                              Offered for active, non-administrator accounts
                              only — the server refuses everything else anyway.
                              See `lib/admin/reset-link.ts` for why
                              administrators are excluded.
                            */}
                            {entry.status === "active" && !isAdministrative ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => void generateResetLink(entry.id)}
                              >
                                <KeyRound />
                                Generate reset link
                              </Button>
                            ) : null}

                            {/*
                              A global scope already covers every salon, so
                              there is nothing to add to it.
                            */}
                            {entry.scope.level !== "global" ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => {
                                  setActionError(null);
                                  setLocationsFor(entry);
                                }}
                              >
                                <MapPin />
                                Edit locations
                              </Button>
                            ) : null}

                            {entry.status !== "disabled" && !isMe ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => void resetCredentials(entry.id, entry.email)}
                              >
                                <RotateCcwKey />
                                Reset credentials
                              </Button>
                            ) : null}

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
        themselves. &ldquo;Generate reset link&rdquo; shows a single-use link
        once, to you only, for you to send them privately; the person still
        chooses their own password. &ldquo;Reset credentials&rdquo; is for an
        account whose password somebody else set: it clears that password,
        signs the person out everywhere, and emails them a link to choose
        their own.
      </Notice>

      <ResetLinkDialog
        link={resetLink}
        onClose={() => setResetLink(null)}
      />

      <EditLocationsDialog
        user={locationsFor}
        error={actionError}
        onClose={() => setLocationsFor(null)}
        onSave={async (target, alsoCoversAreaIds) => {
          /*
           * The WHOLE scope is sent, with only the additional locations
           * changed: the level and primary come from the row as the server last
           * returned it, so saving here cannot move somebody's primary area.
           */
          const saved = await send(target.id, {
            scope: {
              level: target.scope.level,
              primaryAreaId: target.scope.primaryAreaId,
              alsoCoversAreaIds,
            },
          });
          if (saved) setActionNote(`Locations updated for ${target.email}.`);
          return saved;
        }}
      />

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

/* ------------------------------------------------------------ reset link -- */

/**
 * Shows a generated reset link ONCE, to the administrator who asked for it.
 *
 * The link is plain text in a read-only field — never an anchor, so a stray
 * click cannot open it and spend it in the administrator's own browser. Closing
 * the dialog drops it; there is no way to show it again, only to generate a new
 * one (which replaces this one).
 */
export function ResetLinkDialog({
  link,
  onClose,
}: {
  link: { email: string; url: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  function close(open: boolean) {
    if (open) return;
    setCopied("idle");
    onClose();
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <Dialog open={link !== null} onOpenChange={close}>
      <DialogContent
        title="Password reset link"
        description={link ? `For ${link.email}. No email has been sent.` : undefined}
      >
        {link ? (
          <div className="space-y-4">
            <Notice tone="attention" title="This link is a one-time credential">
              Anyone who opens it can set a new password for this account. Send
              it only to {link.email}, privately (for example a direct Teams
              message). Do not open it yourself. It stops working once it is
              used, when it expires, or when another link is generated.
            </Notice>

            <FieldGroup label="Reset link" htmlFor="reset-link-url">
              <Input
                id="reset-link-url"
                readOnly
                value={link.url}
                onFocus={(event) => event.currentTarget.select()}
                autoComplete="off"
                spellCheck={false}
              />
            </FieldGroup>

            {copied === "copied" ? (
              <p role="status" className="text-xs text-muted-foreground">
                Copied. Paste it into a private message to {link.email}.
              </p>
            ) : copied === "failed" ? (
              <p role="status" className="text-xs text-muted-foreground">
                Could not copy automatically. Select the link above and copy it.
              </p>
            ) : null}

            <DialogActions>
              <DialogClose asChild>
                <Button variant="ghost">Close</Button>
              </DialogClose>
              <Button onClick={() => void copy()}>
                <Copy />
                Copy reset link
              </Button>
            </DialogActions>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- invite -- */

/** What the Woven lookup is doing for the address currently typed. */
type SuggestionLookup =
  | { state: "idle" }
  | { state: "loading"; email: string }
  | { state: "done"; email: string; result: InviteSuggestion }
  | { state: "applied"; email: string; result: InviteSuggestion };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SCOPE_LEVEL_LABEL: Record<Exclude<ScopeLevel, "global">, string> = {
  salon: "One salon",
  district: "A district",
  region: "A region",
};

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
  /*
   * ADDITIONAL LOCATIONS: optional, empty for somebody with one location. Held
   * as stable location ids; the names are only for display.
   */
  const [additional, setAdditional] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<SuggestionLookup>({ state: "idle" });
  /* A later lookup supersedes an earlier one that is still in flight. */
  const lookupSeq = useRef(0);

  function reset() {
    setEmail("");
    setDisplayName("");
    setRole("employee");
    setLevel("salon");
    setAreaId(AREAS.salon[0]?.id ?? "");
    setAdditional([]);
    setLookup({ state: "idle" });
    lookupSeq.current += 1;
  }

  /** A new primary can never also be an additional location. */
  function choosePrimary(nextLevel: ScopeLevel, nextArea: string) {
    setAdditional((current) =>
      cleanAdditionalLocations(current, { level: nextLevel, primaryAreaId: nextArea || null }),
    );
  }

  /*
   * ASKS WOVEN, SUGGESTS, CHANGES NOTHING. Runs when the administrator leaves
   * the email field, never on every keystroke, and only for something shaped
   * like an address. A failure (not permitted, Woven not connected, offline) is
   * silent: the form is complete without it, and an error banner about an
   * optional convenience would only get in the way of sending an invitation.
   */
  async function lookUpWoven() {
    const wanted = email.trim().toLowerCase();
    if (!EMAIL_SHAPE.test(wanted)) {
      setLookup({ state: "idle" });
      return;
    }
    if ("email" in lookup && lookup.email === wanted) return;

    const seq = ++lookupSeq.current;
    setLookup({ state: "loading", email: wanted });
    try {
      const response = await fetch(
        `/api/admin/employees/woven/invite-suggestion?email=${encodeURIComponent(wanted)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => null)) as InviteSuggestion | null;
      if (seq !== lookupSeq.current) return;
      if (!response.ok || !payload || !("status" in payload)) {
        setLookup({ state: "idle" });
        return;
      }
      setLookup({ state: "done", email: wanted, result: payload });
    } catch {
      if (seq === lookupSeq.current) setLookup({ state: "idle" });
    }
  }

  /*
   * APPLYING IS THE ADMINISTRATOR'S ACT. Nothing above fills a field; this does,
   * when asked, and every field stays editable afterwards. A value Woven could
   * not vouch for is simply absent from the suggestion and is left as it was —
   * and where the primary area is missing it is left EMPTY, so the form cannot
   * be sent until somebody chooses one rather than inheriting a default.
   */
  function applySuggestion(result: InviteSuggestion) {
    if (result.status !== "found" || !result.suggestion) return;
    const s = result.suggestion;
    if (s.displayName) setDisplayName(s.displayName);
    if (s.role) setRole(s.role);

    let nextLevel: ScopeLevel = level;
    let nextArea = areaId;
    if (s.scopeLevel) {
      nextLevel = s.scopeLevel;
      nextArea = s.primaryAreaId ?? "";
      setLevel(nextLevel);
      setAreaId(nextArea);
    }
    setAdditional(
      cleanAdditionalLocations(s.additionalAreaIds, { level: nextLevel, primaryAreaId: nextArea || null }),
    );
    if (lookup.state === "done") setLookup({ state: "applied", email: lookup.email, result });
  }

  const needsArea = level !== "global" && !areaId;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || needsArea) return;
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
            alsoCoversAreaIds:
              level === "global"
                ? []
                : cleanAdditionalLocations(additional, { level, primaryAreaId: areaId }),
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
      reset();
      onOpenChange(false);
    } catch {
      setError("The invitation could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const suggestion = lookup.state === "done" || lookup.state === "applied" ? lookup.result : null;

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
              onChange={(event) => {
                setEmail(event.target.value);
                // A different address makes any earlier suggestion stale.
                if (lookup.state !== "idle") {
                  setLookup({ state: "idle" });
                  lookupSeq.current += 1;
                }
              }}
              onBlur={() => void lookUpWoven()}
              disabled={busy}
            />
          </FieldGroup>

          {lookup.state === "loading" ? (
            <p role="status" className="text-xs text-muted-foreground">
              Checking Woven…
            </p>
          ) : null}

          {suggestion?.status === "not_found" ? (
            <p role="status" className="text-xs text-muted-foreground">
              No employee with this email was found in Woven. Fill in the details below.
            </p>
          ) : null}

          {suggestion?.status === "ambiguous" ? (
            <p role="status" className="text-xs text-muted-foreground">
              {suggestion.reason}
            </p>
          ) : null}

          {suggestion?.status === "found" ? (
            <Notice tone="neutral" icon={<ShieldCheck />} title="Found in Woven">
              <p>
                {suggestion.employee.name}
                {suggestion.employee.positionName ? ` — ${suggestion.employee.positionName}` : ""}
                {suggestion.employee.primaryLocationName
                  ? `, ${suggestion.employee.primaryLocationName}`
                  : ""}
              </p>
              {suggestion.suggestion ? (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs">
                  {suggestion.suggestion.role ? (
                    <li>Role: {ROLE_LABEL[suggestion.suggestion.role]}</li>
                  ) : null}
                  {suggestion.suggestion.scopeLevel ? (
                    <li>Scope: {SCOPE_LEVEL_LABEL[suggestion.suggestion.scopeLevel]}</li>
                  ) : null}
                  {suggestion.suggestion.primaryAreaId ? (
                    <li>Primary area: {areaLabel(suggestion.suggestion.primaryAreaId)}</li>
                  ) : null}
                  {suggestion.suggestion.additionalAreaIds.length > 0 ? (
                    <li>
                      Additional locations:{" "}
                      {suggestion.suggestion.additionalAreaIds.map((id) => areaLabel(id)).join(", ")}
                    </li>
                  ) : null}
                </ul>
              ) : null}
              {suggestion.notes.length > 0 ? (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                  {suggestion.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
              {suggestion.suggestion ? (
                <div className="mt-2.5 flex items-center gap-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy || lookup.state === "applied"}
                    onClick={() => applySuggestion(suggestion)}
                  >
                    {lookup.state === "applied" ? "Applied" : "Apply suggestions"}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {lookup.state === "applied"
                      ? "Review each field before sending."
                      : "Nothing changes until you apply. You can edit everything after."}
                  </span>
                </div>
              ) : null}
            </Notice>
          ) : null}

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
                const nextArea = next !== "global" ? (AREAS[next][0]?.id ?? "") : "";
                setAreaId(nextArea);
                choosePrimary(next, nextArea);
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
                onChange={(event) => {
                  setAreaId(event.target.value);
                  choosePrimary(level, event.target.value);
                }}
                disabled={busy}
              >
                {areaId === "" ? (
                  <option value="" disabled>
                    Choose a primary area…
                  </option>
                ) : null}
                {AREAS[level].map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </Select>
            </FieldGroup>
          ) : null}

          {/*
            Directly under Primary area, as asked. Hidden for a global scope,
            which already covers every salon and cannot be widened.
          */}
          {level !== "global" ? (
            <FieldGroup
              label="Additional locations (optional)"
              htmlFor="invite-additional"
              hint="Salons this person can access in addition to their primary area. Leave empty if they have just one."
            >
              <MultiSelect
                id="invite-additional"
                options={additionalLocationOptions(level === "salon" ? areaId : null)}
                value={additional}
                onChange={setAdditional}
                disabled={busy}
              />
            </FieldGroup>
          ) : null}

          <DialogActions>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !email || !displayName || needsArea}>
              {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
              {busy ? "Sending…" : "Send invitation"}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------------------------------- edit locations -- */

/**
 * Edits ONE thing: the additional locations of an existing account.
 *
 * The primary area, scope and role are shown and cannot be changed here —
 * those have their own deliberate paths — so opening this and pressing Save
 * cannot move somebody's primary assignment or change what they may do beyond
 * the salons named. Saving sends the account's current level and primary back
 * unchanged with the new list; the server validates it like any other write.
 */
function EditLocationsDialog({
  user,
  onClose,
  onSave,
  error,
}: {
  user: DirectoryUser | null;
  onClose: () => void;
  onSave: (user: DirectoryUser, alsoCoversAreaIds: string[]) => Promise<boolean>;
  error: string | null;
}) {
  return (
    <Dialog open={user !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      {user ? (
        <DialogContent
          title="Edit locations"
          description={`${user.displayName} — ${user.email}`}
        >
          <EditLocationsForm key={user.id} user={user} onClose={onClose} onSave={onSave} error={error} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function EditLocationsForm({
  user,
  onClose,
  onSave,
  error,
}: {
  user: DirectoryUser;
  onClose: () => void;
  onSave: (user: DirectoryUser, alsoCoversAreaIds: string[]) => Promise<boolean>;
  error: string | null;
}) {
  const initial = user.scope.alsoCoversAreaIds;
  const [selected, setSelected] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);

  /*
   * What is offered: the salons, minus the primary. Anything the account ALREADY
   * holds that is not a salon (a district or region added before this existed)
   * is kept selectable by name so it displays and survives a save — it is never
   * silently dropped by opening this dialog.
   */
  const options = useMemo(() => {
    const primary = user.scope.level === "salon" ? user.scope.primaryAreaId : null;
    const held = initial
      .filter((id) => !id.startsWith("loc-"))
      .map((id) => ({ id, name: areaLabel(id) }));
    return [...additionalLocationOptions(primary), ...held];
  }, [user, initial]);

  const cleaned = cleanAdditionalLocations(selected, {
    level: user.scope.level,
    primaryAreaId: user.scope.primaryAreaId,
  });
  const changed =
    cleaned.length !== initial.length || cleaned.some((id) => !initial.includes(id));

  return (
    <div className="space-y-4">
      {error ? (
        <Notice tone="attention" title="That did not work">
          {error}
        </Notice>
      ) : null}

      <p className="text-[13px] text-muted-foreground">
        Primary area: <span className="font-medium text-foreground">{areaName(user.scope)}</span>
        <span className="ml-1 capitalize">({user.scope.level})</span>
      </p>

      <FieldGroup
        label="Additional locations"
        htmlFor="edit-additional"
        hint="Salons this person can access in addition to their primary area. Removing one takes effect on their next request."
      >
        <MultiSelect
          id="edit-additional"
          options={options}
          value={selected}
          onChange={setSelected}
          disabled={busy}
        />
      </FieldGroup>

      <DialogActions>
        <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy || !changed}
          onClick={async () => {
            setBusy(true);
            const saved = await onSave(user, cleaned);
            setBusy(false);
            if (saved) onClose();
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <MapPin />}
          {busy ? "Saving…" : "Save locations"}
        </Button>
      </DialogActions>
    </div>
  );
}
