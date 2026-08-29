import type { Role, User } from "@/types";
import { isoHoursFromAnchor } from "@/lib/utils/date";

/**
 * Demo users. All names are fictional.
 *
 * The end-state auth model this reflects: every person gets their own login.
 * Salon-level accounts sign in under the salon email address as a Salon
 * Director (`isSalonAccount: true`); District and Regional Managers get
 * personal logins. Nobody shares a credential.
 */
export const DEMO_USERS: User[] = [
  {
    id: "user-owner",
    name: "Marguerite Ellis",
    email: "m.ellis@jbaoperations.demo",
    role: "owner",
    scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
    isSalonAccount: false,
    active: true,
    avatarInitials: "ME",
    title: "Operating Partner",
    lastActiveAt: isoHoursFromAnchor(-2),
    createdAt: "2025-11-04T15:20:00.000Z",
  },
  {
    id: "user-dev",
    name: "Priya Raghunathan",
    email: "priya@jbaoperations.demo",
    role: "developer",
    scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
    isSalonAccount: false,
    active: true,
    avatarInitials: "PR",
    title: "Platform Administrator",
    lastActiveAt: isoHoursFromAnchor(-6),
    createdAt: "2025-11-04T15:22:00.000Z",
  },
  {
    id: "user-rm-1",
    name: "Dana Whitfield",
    email: "d.whitfield@jbaoperations.demo",
    role: "regional_manager",
    scope: {
      level: "region",
      primaryAreaId: "reg-a",
      alsoCoversAreaIds: ["dist-3"],
    },
    isSalonAccount: false,
    active: true,
    avatarInitials: "DW",
    title: "Regional Manager — Region A",
    lastActiveAt: isoHoursFromAnchor(-19),
    createdAt: "2025-12-02T14:00:00.000Z",
  },
  {
    id: "user-rm-2",
    name: "Terrence Boyd",
    email: "t.boyd@jbaoperations.demo",
    role: "regional_manager",
    scope: { level: "region", primaryAreaId: "reg-b", alsoCoversAreaIds: [] },
    isSalonAccount: false,
    active: true,
    avatarInitials: "TB",
    title: "Regional Manager — Region B",
    lastActiveAt: isoHoursFromAnchor(-30),
    createdAt: "2025-12-02T14:04:00.000Z",
  },
  {
    id: "user-dm-1",
    name: "Alicia Moreno",
    email: "a.moreno@jbaoperations.demo",
    role: "district_manager",
    scope: {
      level: "district",
      primaryAreaId: "dist-1",
      alsoCoversAreaIds: ["dist-2"],
    },
    isSalonAccount: false,
    active: true,
    avatarInitials: "AM",
    title: "District Manager — District 1",
    lastActiveAt: isoHoursFromAnchor(-4),
    createdAt: "2026-01-12T16:10:00.000Z",
  },
  {
    id: "user-dm-2",
    name: "Corey Vandenberg",
    email: "c.vandenberg@jbaoperations.demo",
    role: "district_manager",
    scope: { level: "district", primaryAreaId: "dist-3", alsoCoversAreaIds: [] },
    isSalonAccount: false,
    active: true,
    avatarInitials: "CV",
    title: "District Manager — District 3",
    lastActiveAt: isoHoursFromAnchor(-27),
    createdAt: "2026-01-12T16:14:00.000Z",
  },
  {
    id: "user-dm-3",
    name: "Renata Silva",
    email: "r.silva@jbaoperations.demo",
    role: "district_manager",
    scope: { level: "district", primaryAreaId: "dist-4", alsoCoversAreaIds: [] },
    isSalonAccount: false,
    active: false,
    avatarInitials: "RS",
    title: "District Manager — District 4",
    lastActiveAt: "2026-06-18T13:05:00.000Z",
    createdAt: "2026-02-03T11:30:00.000Z",
  },
  {
    id: "user-sd-101",
    name: "Riverbend Commons",
    email: "riverbend@jbasalons.demo",
    role: "salon_director",
    scope: { level: "salon", primaryAreaId: "loc-101", alsoCoversAreaIds: [] },
    isSalonAccount: true,
    active: true,
    avatarInitials: "RC",
    title: "Salon Director — Riverbend Commons",
    lastActiveAt: isoHoursFromAnchor(-1),
    createdAt: "2026-02-20T09:00:00.000Z",
  },
  {
    id: "user-sd-104",
    name: "Cedar Point Plaza",
    email: "cedarpoint@jbasalons.demo",
    role: "salon_director",
    scope: { level: "salon", primaryAreaId: "loc-104", alsoCoversAreaIds: [] },
    isSalonAccount: true,
    active: true,
    avatarInitials: "CP",
    title: "Salon Director — Cedar Point Plaza",
    lastActiveAt: isoHoursFromAnchor(-8),
    createdAt: "2026-02-20T09:04:00.000Z",
  },
  {
    id: "user-sd-108",
    name: "Harborview Landing",
    email: "harborview@jbasalons.demo",
    role: "salon_director",
    scope: { level: "salon", primaryAreaId: "loc-108", alsoCoversAreaIds: [] },
    isSalonAccount: true,
    active: true,
    avatarInitials: "HL",
    title: "Salon Director — Harborview Landing",
    lastActiveAt: isoHoursFromAnchor(-22),
    createdAt: "2026-02-20T09:06:00.000Z",
  },
  {
    id: "user-sd-112",
    name: "Summit Row",
    email: "summitrow@jbasalons.demo",
    role: "salon_director",
    scope: { level: "salon", primaryAreaId: "loc-112", alsoCoversAreaIds: [] },
    isSalonAccount: true,
    active: true,
    avatarInitials: "SR",
    title: "Salon Director — Summit Row",
    lastActiveAt: isoHoursFromAnchor(-52),
    createdAt: "2026-03-09T10:15:00.000Z",
  },
  {
    id: "user-asd-1",
    name: "Jordan Beckley",
    email: "j.beckley@jbaoperations.demo",
    role: "assistant_salon_director",
    scope: { level: "salon", primaryAreaId: "loc-101", alsoCoversAreaIds: [] },
    isSalonAccount: false,
    active: true,
    avatarInitials: "JB",
    title: "Assistant Salon Director — Riverbend Commons",
    lastActiveAt: isoHoursFromAnchor(-14),
    createdAt: "2026-04-01T12:00:00.000Z",
  },
  {
    id: "user-asd-2",
    name: "Nia Okafor",
    email: "n.okafor@jbaoperations.demo",
    role: "assistant_salon_director",
    scope: { level: "salon", primaryAreaId: "loc-108", alsoCoversAreaIds: [] },
    isSalonAccount: false,
    active: true,
    avatarInitials: "NO",
    title: "Assistant Salon Director — Harborview Landing",
    lastActiveAt: isoHoursFromAnchor(-40),
    createdAt: "2026-04-01T12:02:00.000Z",
  },
];

/**
 * Whose account the demo signs in as for each "Demo role" selection. The
 * switcher in the profile menu swaps between these so a presenter can show how
 * navigation and permissions change per role.
 */
export const DEMO_ROLE_ACCOUNTS: Record<Role, string> = {
  assistant_salon_director: "user-asd-1",
  salon_director: "user-sd-101",
  district_manager: "user-dm-1",
  regional_manager: "user-rm-1",
  owner: "user-owner",
  developer: "user-dev",
};

/** Roles offered in the demo switcher, in presentation order. */
export const DEMO_SWITCHABLE_ROLES: Role[] = [
  "salon_director",
  "district_manager",
  "regional_manager",
  "owner",
];

export function userById(id: string): User | undefined {
  return DEMO_USERS.find((user) => user.id === id);
}

export function userForRole(role: Role): User {
  const id = DEMO_ROLE_ACCOUNTS[role];
  return userById(id) ?? DEMO_USERS[0];
}
