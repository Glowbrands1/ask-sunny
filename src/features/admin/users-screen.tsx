"use client";

import { useMemo, useState } from "react";
import { Building2, Info, KeyRound, Search, ShieldCheck, UserPlus } from "lucide-react";

import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { FieldGroup, Input, Select } from "@/components/ui/field";
import { DemoDataNote, EmptyState, Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, SectionHeader } from "@/components/ui/layout";
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  Tooltip,
} from "@/components/ui/overlays";
import { DEMO_DISTRICTS, DEMO_LOCATIONS, DEMO_REGIONS, areaLabel } from "@/data/demo/locations";
import { DEMO_USERS } from "@/data/demo/users";
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLES } from "@/lib/permissions";
import { cn } from "@/lib/utils/cn";
import { relativeTime } from "@/lib/utils/date";
import { pluralize } from "@/lib/utils/format";
import type { Role, User } from "@/types";
import { PermissionsMatrix } from "./permissions-matrix";

/**
 * User management.
 *
 * Deliberate separation: this screen edits *profile* data — name, role, scope,
 * active status. It never touches credentials. "Set new password" opens an
 * explanation rather than a password field, because storing or setting a
 * password here would be exactly the wrong thing for a prototype to do.
 */
export function UsersScreen() {
  const [users, setUsers] = useState<User[]>(DEMO_USERS);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [passwordUser, setPasswordUser] = useState<User | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((user) => (roleFilter === "all" ? true : user.role === roleFilter))
      .filter((user) => {
        if (!q) return true;
        return (
          user.name.toLowerCase().includes(q) ||
          user.email.toLowerCase().includes(q) ||
          ROLE_LABEL[user.role].toLowerCase().includes(q) ||
          user.title.toLowerCase().includes(q)
        );
      });
  }, [users, query, roleFilter]);

  const editing = users.find((user) => user.id === editingId) ?? null;

  const patchUser = (id: string, patch: Partial<User>) => {
    setUsers((current) =>
      current.map((user) => (user.id === id ? { ...user, ...patch } : user)),
    );
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Admin"
        title="User Management"
        description="Individual logins for every person. Salon accounts sign in under the salon email — nobody shares a credential."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus />
            Add user
          </Button>
        }
      />

      <Tabs defaultValue="team">
        <TabsList>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
        </TabsList>

        {/* Team */}
        <TabsContent value="team">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-muted-foreground">
              {filtered.length} {pluralize(filtered.length, "person", "people")}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name, email or role…"
                  aria-label="Search users"
                  className="pl-9 sm:w-64"
                />
              </div>
              <Select
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value as Role | "all")}
                aria-label="Filter by role"
                className="sm:w-56"
              >
                <option value="all">All roles</option>
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No people match"
              description="Try a different search term or clear the role filter."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    setRoleFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((user) => (
                <Card key={user.id}>
                  <CardContent className="flex h-full flex-col p-5">
                    <div className="flex items-start gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary-soft-foreground">
                        {user.avatarInitials}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold text-foreground">
                          {user.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                      <Badge tone={user.active ? "ready" : "neutral"} size="sm">
                        <StatusDot />
                        {user.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>

                    <div className="mt-3.5 flex flex-wrap gap-1.5">
                      <Badge tone="primary" size="sm">
                        {ROLE_LABEL[user.role]}
                      </Badge>
                      {user.isSalonAccount ? (
                        <Tooltip content="Signs in under the salon email address as a Salon Director.">
                          <span className="inline-flex">
                            <Badge tone="accent" size="sm">
                              <Building2 className="size-2.5" aria-hidden />
                              Salon account
                            </Badge>
                          </span>
                        </Tooltip>
                      ) : null}
                    </div>

                    <p className="mt-3 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                      {areaLabel(user.scope.primaryAreaId)}
                      {user.scope.alsoCoversAreaIds.length > 0 ? (
                        <span className="mt-1 block text-xs text-subtle-foreground">
                          Also covers:{" "}
                          {user.scope.alsoCoversAreaIds
                            .map((id) => areaLabel(id))
                            .join(", ")}
                        </span>
                      ) : null}
                    </p>

                    <p className="mt-3 text-xs text-subtle-foreground">
                      Last active {relativeTime(user.lastActiveAt)}
                    </p>

                    <div className="mt-4 flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        onClick={() => setEditingId(user.id)}
                      >
                        Manage
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPasswordUser(user)}
                      >
                        <KeyRound />
                        <span className="sr-only">Set new password for {user.name}</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <DemoDataNote className="mt-5" />
        </TabsContent>

        {/* Organization */}
        <TabsContent value="organization">
          <SectionHeader
            title="Organization structure"
            description="Regions, districts and salons. Scope assignments reference these."
          />
          <div className="space-y-4">
            {DEMO_REGIONS.map((region) => (
              <Card key={region.id}>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[15px] font-semibold text-foreground">
                      {region.name}
                    </h3>
                    <Badge tone="neutral" size="sm">
                      {
                        users.filter(
                          (user) =>
                            user.scope.primaryAreaId === region.id ||
                            user.scope.alsoCoversAreaIds.includes(region.id),
                        ).length
                      }{" "}
                      assigned
                    </Badge>
                  </div>

                  <div className="mt-4 space-y-3">
                    {DEMO_DISTRICTS.filter(
                      (district) => district.regionId === region.id,
                    ).map((district) => (
                      <div
                        key={district.id}
                        className="rounded-[var(--radius-sm)] border border-border p-3.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[13px] font-medium text-foreground">
                            {district.name}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {
                              DEMO_LOCATIONS.filter(
                                (location) => location.districtId === district.id,
                              ).length
                            }{" "}
                            salons
                          </span>
                        </div>
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {DEMO_LOCATIONS.filter(
                            (location) => location.districtId === district.id,
                          ).map((location) => (
                            <li key={location.id}>
                              <span className="inline-flex rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs text-muted-foreground">
                                {location.name}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Notice tone="neutral" icon={<Info />} className="mt-5">
            <p className="font-semibold text-foreground">The end-state login model</p>
            <p className="mt-1">
              Every person gets an individual login. Salon-level accounts sign in
              under the salon email address as a Salon Director; District and
              Regional Managers get personal logins. This replaces the single
              shared credential in use today, and it is what makes per-user chat
              history, scoped reporting and an audit trail possible.
            </p>
          </Notice>
        </TabsContent>

        {/* Permissions */}
        <TabsContent value="permissions">
          <PermissionsMatrix />
        </TabsContent>
      </Tabs>

      {/* Manage user */}
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditingId(null);
        }}
      >
        {editing ? (
          <DialogContent
            title={`Manage — ${editing.name}`}
            description={editing.email}
          >
            <div className="space-y-4">
              <FieldGroup label="Role" htmlFor="edit-role">
                <Select
                  id="edit-role"
                  value={editing.role}
                  onChange={(event) =>
                    patchUser(editing.id, { role: event.target.value as Role })
                  }
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role]}
                    </option>
                  ))}
                </Select>
              </FieldGroup>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {ROLE_DESCRIPTION[editing.role]}
              </p>

              <FieldGroup label="Scope level" htmlFor="edit-scope-level">
                <Select
                  id="edit-scope-level"
                  value={editing.scope.level}
                  onChange={(event) =>
                    patchUser(editing.id, {
                      scope: {
                        ...editing.scope,
                        level: event.target.value as User["scope"]["level"],
                      },
                    })
                  }
                >
                  <option value="global">Global — all salons</option>
                  <option value="region">Region</option>
                  <option value="district">District</option>
                  <option value="salon">Single salon</option>
                </Select>
              </FieldGroup>

              <FieldGroup
                label="Primary area"
                htmlFor="edit-area"
                hint="The area this person owns."
              >
                <Select
                  id="edit-area"
                  value={editing.scope.primaryAreaId ?? ""}
                  onChange={(event) =>
                    patchUser(editing.id, {
                      scope: {
                        ...editing.scope,
                        primaryAreaId: event.target.value || null,
                      },
                    })
                  }
                >
                  <option value="">All areas</option>
                  <optgroup label="Regions">
                    {DEMO_REGIONS.map((region) => (
                      <option key={region.id} value={region.id}>
                        {region.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Districts">
                    {DEMO_DISTRICTS.map((district) => (
                      <option key={district.id} value={district.id}>
                        {district.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Salons">
                    {DEMO_LOCATIONS.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </optgroup>
                </Select>
              </FieldGroup>

              <div>
                <p className="eyebrow mb-2">Also covers</p>
                <p className="mb-2.5 text-xs leading-relaxed text-muted-foreground">
                  Regional and District Managers frequently cover extra areas on
                  top of their own.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[...DEMO_REGIONS, ...DEMO_DISTRICTS].map((area) => {
                    const selected = editing.scope.alsoCoversAreaIds.includes(area.id);
                    return (
                      <button
                        key={area.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          patchUser(editing.id, {
                            scope: {
                              ...editing.scope,
                              alsoCoversAreaIds: selected
                                ? editing.scope.alsoCoversAreaIds.filter(
                                    (id) => id !== area.id,
                                  )
                                : [...editing.scope.alsoCoversAreaIds, area.id],
                            },
                          })
                        }
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs transition-colors",
                          selected
                            ? "border-primary bg-primary-soft text-primary-soft-foreground"
                            : "border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground",
                        )}
                      >
                        {area.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-border bg-surface-muted px-3.5 py-3">
                <div>
                  <p className="text-[13px] font-medium text-foreground">
                    Account status
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Deactivating removes access without deleting history.
                  </p>
                </div>
                <Button
                  variant={editing.active ? "destructive" : "secondary"}
                  size="sm"
                  onClick={() => patchUser(editing.id, { active: !editing.active })}
                >
                  {editing.active ? "Deactivate account" : "Reactivate account"}
                </Button>
              </div>
            </div>

            <DialogActions>
              <DialogClose asChild>
                <Button variant="ghost">Close</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button>Update</Button>
              </DialogClose>
            </DialogActions>
          </DialogContent>
        ) : null}
      </Dialog>

      {/* Add user */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent
          title="Add a user"
          description="Creating accounts requires the production identity provider."
        >
          <Notice tone="neutral" icon={<ShieldCheck />}>
            <p className="font-semibold text-foreground">Not available in the prototype</p>
            <p className="mt-1">
              Adding a user creates a real login, which needs an identity
              provider to be connected — Supabase Auth unless another is
              chosen. This prototype deliberately has no account creation and
              no credential storage of any kind.
            </p>
          </Notice>
          <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
            When it is wired up, this dialog collects name, email, role and scope
            — and the identity provider sends the invitation. Ask Sunny stores
            the profile, never the password.
          </p>
          <DialogActions>
            <DialogClose asChild>
              <Button>Understood</Button>
            </DialogClose>
          </DialogActions>
        </DialogContent>
      </Dialog>

      {/* Password */}
      <Dialog
        open={Boolean(passwordUser)}
        onOpenChange={(open) => {
          if (!open) setPasswordUser(null);
        }}
      >
        {passwordUser ? (
          <DialogContent
            title="Set a new password"
            description={`For ${passwordUser.name} — ${passwordUser.email}`}
          >
            <Notice tone="neutral" icon={<ShieldCheck />}>
              <p className="font-semibold text-foreground">
                Passwords are never handled here
              </p>
              <p className="mt-1">
                In production this triggers a password reset through the identity
                provider, which emails the user a secure link. Ask Sunny never
                sees, stores, or sets a password — and this prototype has no
                password storage at all.
              </p>
            </Notice>
            <DialogActions>
              <DialogClose asChild>
                <Button>Close</Button>
              </DialogClose>
            </DialogActions>
          </DialogContent>
        ) : null}
      </Dialog>
    </PageShell>
  );
}
