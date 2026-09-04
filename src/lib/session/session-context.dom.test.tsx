// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_PERMISSION_MATRIX } from "@/lib/permissions";
import type { AccessScope, Permission } from "@/types";

import { SessionProvider, useSession } from "./session-context";
import type { AuthenticatedSession } from "./authenticated-user";

/**
 * ============================================================================
 * THE SESSION IN REAL MODE.
 * ============================================================================
 *
 * The demo path is a role switcher backed by sessionStorage. The real path is
 * an identity the SERVER resolved and passed down as a prop. They are not two
 * settings of one mechanism, and these tests are about the places where
 * treating them as one would be a security bug:
 *
 *   The demo role setters must be UNREACHABLE. Not no-ops — unreachable — so
 *   that a leftover call site fails loudly rather than appearing to work.
 *
 *   `can()` must read the SERVER matrix. The browser's copy is persisted in
 *   IndexedDB and editable in demo mode, and a person who edited theirs must
 *   not thereby see the admin console appear.
 */

const scope: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

const CURT: AuthenticatedSession = {
  subject: "11111111-1111-4111-8111-111111111111",
  email: "an.admin@suntancity.test",
  displayName: "An Admin",
  role: "admin",
  scope,
};

const FRONTLINE: AuthenticatedSession = {
  subject: "22222222-2222-4222-8222-222222222222",
  email: "frontline@suntancity.test",
  displayName: "A Frontline Employee",
  role: "employee",
  scope: { level: "salon", primaryAreaId: "loc-101", alsoCoversAreaIds: [] },
};

/**
 * The app store is mocked with a DELIBERATELY WRONG matrix.
 *
 * Giving the browser's copy every permission is how "real mode ignores it" gets
 * proved: if `can()` consulted this, an Employee would come back able to manage
 * users, and the assertion below would fail. A matrix that merely agreed with
 * the server would make the test pass either way.
 */
const store = vi.hoisted(() => ({
  matrix: {} as Record<string, Permission[]>,
}));

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: () => ({ permissionMatrix: store.matrix, resetDemoData: async () => {} }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }),
}));

afterEach(cleanup);

/**
 * The live session value, captured on render.
 *
 * The two refusals are asserted by CALLING THEM, not by clicking a button that
 * calls them. A throw inside a React event handler does not propagate to the
 * caller — React catches it and re-reports it as an unhandled error — so
 * `expect(...).toThrow()` around a click passes or fails for reasons that have
 * nothing to do with the function under test.
 */
/** Renders whatever the session says. */
function Probe() {
  const session = useSession();
  /*
   * The refusals are exercised THROUGH BUTTONS, with the outcome rendered.
   *
   * Two dead ends got here. Asserting `expect(click).toThrow()` does not work:
   * React catches an error thrown in an event handler and re-reports it as an
   * unhandled error, so the assertion passes or fails for unrelated reasons.
   * Capturing the session into a module variable during render does not work
   * either, and shouldn't — render must be pure, and the lint rules say so.
   *
   * Calling them from a handler and rendering what came back tests the path a
   * real caller would take, which is better than either.
   */
  const [outcome, setOutcome] = React.useState("(not called)");
  const attempt = (label: string, work: () => void) => () => {
    try {
      work();
      setOutcome(`${label}: no error`);
    } catch (error) {
      setOutcome(`${label}: ${(error as Error).message}`);
    }
  };

  return (
    <div>
      <span data-testid="signed-in">{String(session.signedIn)}</span>
      <span data-testid="authenticated">{String(session.authenticated)}</span>
      <span data-testid="hydrated">{String(session.hydrated)}</span>
      <span data-testid="role">{session.role}</span>
      <span data-testid="name">{session.user.name}</span>
      <span data-testid="email">{session.user.email}</span>
      <span data-testid="initials">{session.user.avatarInitials}</span>
      <span data-testid="is-admin">{String(session.isAdmin)}</span>
      <span data-testid="can-manage-users">{String(session.can("manage_users"))}</span>
      <span data-testid="can-ask">{String(session.can("ask_questions"))}</span>
      <span data-testid="outcome">{outcome}</span>
      <button type="button" onClick={attempt("setDemoRole", () => session.setDemoRole("owner"))}>
        switch role
      </button>
      <button
        type="button"
        onClick={attempt("signInAsDemo", () => session.signInAsDemo("owner"))}
      >
        demo sign in
      </button>
    </div>
  );
}

function renderReal(session: AuthenticatedSession | null) {
  // Every permission, to prove the browser's matrix is not consulted.
  store.matrix = {
    employee: [...(DEFAULT_PERMISSION_MATRIX.owner ?? [])],
    admin: [...(DEFAULT_PERMISSION_MATRIX.owner ?? [])],
  } as never;
  return render(
    <SessionProvider session={session} productionAuth>
      <Probe />
    </SessionProvider>,
  );
}

const value = (id: string) => screen.getByTestId(id).textContent;

describe("a real session", () => {
  it("is signed in and hydrated on the FIRST render", () => {
    /*
     * No splash, no flash. The demo path has to read sessionStorage before it
     * knows, so it renders a loading state; the server already answered here,
     * and a shell that rendered as a stranger and then corrected itself would
     * be visible on every page load.
     */
    renderReal(CURT);
    expect(value("signed-in")).toBe("true");
    expect(value("hydrated")).toBe("true");
    expect(value("authenticated")).toBe("true");
  });

  it("takes the role, name and email from the server's identity", () => {
    renderReal(CURT);
    expect(value("role")).toBe("admin");
    expect(value("name")).toBe("An Admin");
    expect(value("email")).toBe("an.admin@suntancity.test");
    expect(value("initials")).toBe("AA");
    expect(value("is-admin")).toBe("true");
  });

  it("is signed OUT when the server resolved nobody", () => {
    renderReal(null);
    expect(value("signed-in")).toBe("false");
    expect(value("authenticated")).toBe("false");
    // Still hydrated: "nobody is signed in" is an answer, not a pending state.
    expect(value("hydrated")).toBe("true");
  });
});

describe("the browser's permission matrix is ignored", () => {
  it("denies an Employee manage_users even though the local matrix grants it", () => {
    /*
     * THE LOAD-BEARING TEST. The mocked store gives `employee` every permission
     * the owner has. If `can()` read it, this would come back true.
     */
    expect(store.matrix).toBeDefined();
    renderReal(FRONTLINE);

    expect(value("can-manage-users")).toBe("false");
    expect(value("can-ask")).toBe("true");
    expect(value("is-admin")).toBe("false");
  });
});

describe("the demo role controls are unreachable", () => {
  it("THROWS when something tries to switch role", () => {
    /*
     * Loudly, not quietly. A silent no-op leaves a control on screen that
     * appears to work; a throw is a bug report. The UI does not render either
     * control in real mode, so reaching one means something is wrong.
     */
    renderReal(CURT);
    fireEvent.click(screen.getByText("switch role"));

    expect(value("outcome")).toMatch(
      /setDemoRole: .*not available when real authentication is configured/,
    );
    // And the role is unchanged by the attempt.
    expect(value("role")).toBe("admin");
  });

  it("THROWS when something tries a demo sign-in", () => {
    renderReal(CURT);
    fireEvent.click(screen.getByText("demo sign in"));

    expect(value("outcome")).toMatch(
      /signInAsDemo: .*not available when real authentication is configured/,
    );
  });
});

describe("demo mode is untouched", () => {
  it("still starts un-hydrated and signed out, with the demo default role", () => {
    /*
     * The regression guard for the presenter's flow. `productionAuth` false and
     * no session is the existing behaviour, and it must still read sessionStorage
     * rather than being short-circuited by the new branches.
     */
    store.matrix = DEFAULT_PERMISSION_MATRIX as never;
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    expect(value("authenticated")).toBe("false");
    expect(value("signed-in")).toBe("false");
    expect(value("role")).toBe("salon_director");
  });

  it("lets the demo controls run without throwing", () => {
    store.matrix = DEFAULT_PERMISSION_MATRIX as never;
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    fireEvent.click(screen.getByText("switch role"));
    expect(value("outcome")).toBe("setDemoRole: no error");

    fireEvent.click(screen.getByText("demo sign in"));
    expect(value("outcome")).toBe("signInAsDemo: no error");
  });
});
