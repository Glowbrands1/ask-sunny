import type { Role, User } from "@/types";
import { isoHoursFromAnchor } from "@/lib/utils/date";

/**
 * Demo users. All PEOPLE here are fictional; the salons they are scoped to are
 * not — the four salon accounts below name real stores from the roster in
 * `locations.ts`, so a scope line in the UI reads "MO Kansas City Wornall"
 * rather than an invented store nobody at the company would recognise.
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
    scope: { level: "district", primaryAreaId: "dist-2", alsoCoversAreaIds: [] },
    isSalonAccount: false,
    active: false,
    avatarInitials: "RS",
    title: "District Manager — District 2",
    lastActiveAt: "2026-06-18T13:05:00.000Z",
    createdAt: "2026-02-03T11:30:00.000Z",
  },
  {
    id: "user-sd-0306",
    name: "MO Kansas City Wornall",
    email: "kcwornall@jbasalons.demo",
    role: "salon_director",
    scope: { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: [] },
    isSalonAccount: true,
    active: true,
    avatarInitials: "KW",
    title: "Salon Director — MO Kansas City Wornall",
    lastActiveAt: isoHoursFromAnchor(-1),
    createdAt: "2026-02-20T09:00:00.000Z",
  },
  {
    id: "user-sd-0463",
    name: "KS Shawnee Mission Pkwy",
    email: "shawneemission@jbasalons.demo",
    role: "salon_director",
    scope: { level: "salon", primaryAreaId: "loc-0463", alsoCoversAreaIds: [] },
    isSalonAccount: true,
    active: true,
    avatarInitials: "SM",
    title: "Salon Director — KS Shawnee Mission Pkwy",
    lastActiveAt: isoHoursFromAnchor(-8),
    createdAt: "2026-02-20T09:04:00.000Z",
  },
  {
    id: "user-sd-0314",
    name: "NE Omaha 144th and Center",
    email: "omaha144th@jbasalons.demo",
    role: "salon_director",
    scope: { level: "salon", primaryAreaId: "loc-0314", alsoCoversAreaIds: [] },
    isSalonAccount: true,
    active: true,
    avatarInitials: "OC",
    title: "Salon Director — NE Omaha 144th and Center",
    lastActiveAt: isoHoursFromAnchor(-22),
    createdAt: "2026-02-20T09:06:00.000Z",
  },
  {
    id: "user-sd-0310",
    name: "NE Lincoln 27th Street",
    email: "lincoln27th@jbasalons.demo",
    role: "salon_director",
    scope: { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] },
    isSalonAccount: true,
    active: true,
    avatarInitials: "L2",
    title: "Salon Director — NE Lincoln 27th Street",
    lastActiveAt: isoHoursFromAnchor(-52),
    createdAt: "2026-03-09T10:15:00.000Z",
  },
  {
    id: "user-asd-1",
    name: "Jordan Beckley",
    email: "j.beckley@jbaoperations.demo",
    role: "assistant_salon_director",
    scope: { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: [] },
    isSalonAccount: false,
    active: true,
    avatarInitials: "JB",
    title: "Assistant Salon Director — MO Kansas City Wornall",
    lastActiveAt: isoHoursFromAnchor(-14),
    createdAt: "2026-04-01T12:00:00.000Z",
  },
  {
    id: "user-asd-2",
    name: "Nia Okafor",
    email: "n.okafor@jbaoperations.demo",
    role: "assistant_salon_director",
    scope: { level: "salon", primaryAreaId: "loc-0314", alsoCoversAreaIds: [] },
    isSalonAccount: false,
    active: true,
    avatarInitials: "NO",
    title: "Assistant Salon Director — NE Omaha 144th and Center",
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
  /*
   * The two roles added with real authentication have no seeded demo account,
   * and deliberately so: `employee` and `admin` are roles for REAL people, and
   * the demo switcher exists to preview the manager hierarchy. They map to the
   * nearest seeded account only so this record stays exhaustive; neither is
   * offered in DEMO_SWITCHABLE_ROLES below.
   */
  employee: "user-asd-1",
  admin: "user-owner",
  assistant_salon_director: "user-asd-1",
  salon_director: "user-sd-0306",
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
