// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { WovenSyncStatus } from "@/lib/employees/woven/status";
import { cronDeployed, type WovenSyncPageProps } from "./load";
import { stepsFor, WovenSyncScreen } from "./woven-sync-screen";

/**
 * The Woven Employee Sync screen reports measured and evidenced state, step by
 * step. It never claims Woven is the only thing left, never calls a switch a
 * schedule, never calls every database error a missing table, and never
 * claims personal email cannot be copied when no domain filter is set.
 */

afterEach(cleanup);

const BASE: WovenSyncPageProps = {
  enabled: false,
  scheduleEnabled: false,
  scheduleDeployed: false,
  liveMode: true,
  missingCredentials: ["WOVEN_SUBSCRIPTION_KEY", "WOVEN_USERNAME", "WOVEN_PASSWORD"],
  workEmailDomains: [],
  database: { state: "missing" },
};

function status(overrides: Partial<WovenSyncStatus> = {}): WovenSyncStatus {
  return {
    enabled: true,
    scheduleEnabled: false,
    missingCredentials: [],
    problems: [],
    lastSuccessAt: null,
    lastCronSuccessAt: null,
    signInEvidence: null,
    unmappedLocations: 0,
    unreviewedChanges: 0,
    recentRuns: [],
    ...overrides,
  };
}

const step = (props: WovenSyncPageProps, key: string) => stepsFor(props).find((s) => s.key === key)!;

describe("go-live steps", () => {
  it("distinguishes every step and marks none complete from configuration alone", () => {
    const steps = stepsFor(BASE);
    expect(steps.map((s) => s.key)).toEqual(["subscription", "credentials", "signin", "response", "directory", "first", "schedule"]);
    expect(steps.filter((s) => s.state === "done")).toEqual([]);
  });

  it("never says Waiting on Woven, and does not claim Woven is the only dependency", () => {
    const { container } = render(<WovenSyncScreen {...BASE} />);
    expect(container.textContent).not.toMatch(/waiting on woven|only remaining|one remaining dependency/i);
  });

  it("reports the subscription as reported-active until a run proves sign-in, and confirmed after", () => {
    expect(step(BASE, "subscription")).toMatchObject({ state: "reported", label: "Reported active" });
    const signedIn = { ...BASE, missingCredentials: [], database: { state: "ready" as const, status: status({ signInEvidence: "succeeded" }) } };
    expect(step(signedIn, "subscription").state).toBe("done");
    expect(step(signedIn, "signin").state).toBe("done");
    const refused = { ...BASE, database: { state: "ready" as const, status: status({ signInEvidence: "failed" }) } };
    expect(step(refused, "signin").state).toBe("attention");
  });

  it("credentials configured is NOT sign-in succeeded", () => {
    const configured = { ...BASE, missingCredentials: [] };
    expect(step(configured, "credentials").state).toBe("done");
    expect(step(configured, "signin")).toMatchObject({ state: "pending", label: "Not yet confirmed" });
    expect(step(configured, "response").state).toBe("pending");
  });

  it("names missing credential variables, never values", () => {
    expect(step(BASE, "credentials").detail).toContain("WOVEN_SUBSCRIPTION_KEY");
  });

  it("keeps a missing table apart from a database that did not answer", () => {
    expect(step(BASE, "directory")).toMatchObject({ label: "Not created" });
    const down = { ...BASE, database: { state: "unavailable" as const, code: "57014" } };
    expect(step(down, "directory")).toMatchObject({ state: "attention", label: "Could not be read" });
    expect(step(down, "directory").detail).toContain("57014");
    expect(step(down, "directory").detail).toMatch(/not the same as the tables being missing/);
  });

  describe("the daily schedule", () => {
    it("a switch alone is not a schedule", () => {
      const s = step({ ...BASE, scheduleEnabled: true }, "schedule");
      expect(s.state).toBe("attention");
      expect(s.label).toBe("Switch on, not scheduled");
    });

    it("deployed and switched on, without a successful scheduled run, is not complete", () => {
      const s = step({ ...BASE, scheduleEnabled: true, scheduleDeployed: true, database: { state: "ready", status: status({ lastSuccessAt: "2026-10-01T11:00:00Z" }) } }, "schedule");
      expect(s.state).toBe("pending");
    });

    it("is complete only with the entry deployed, the switch on and a scheduled run that succeeded", () => {
      const s = step(
        {
          ...BASE,
          scheduleEnabled: true,
          scheduleDeployed: true,
          database: { state: "ready", status: status({ lastSuccessAt: "2026-10-05T11:31:00Z", lastCronSuccessAt: "2026-10-05T11:31:00Z" }) },
        },
        "schedule",
      );
      expect(s).toMatchObject({ state: "done", label: "Running daily" });
      expect(s.detail).toContain("Oct 5, 6:31 AM");
    });

    it("reads the deployed cron entry from vercel.json, not from a flag", () => {
      expect(cronDeployed({ crons: [{ path: "/api/reviews/apify/cron" }] })).toBe(false);
      expect(cronDeployed({ crons: [{ path: "/api/employees/woven/cron" }] })).toBe(true);
      expect(cronDeployed({})).toBe(false);
    });
  });
});

describe("the screen", () => {
  it("leads with the next step", () => {
    render(<WovenSyncScreen {...BASE} />);
    expect(screen.getByText("Next step: Server-side credentials")).toBeTruthy();
  });

  it("warns that a personal address in the work-email field would be copied when no domain is set", () => {
    const { container } = render(<WovenSyncScreen {...BASE} />);
    expect(screen.getByText("No company email domain is set")).toBeTruthy();
    expect(container.textContent).not.toMatch(/personal phone and email/i);
  });

  it("states the domain filter when one is set", () => {
    render(<WovenSyncScreen {...BASE} workEmailDomains={["suntancity.com"]} />);
    expect(screen.queryByText("No company email domain is set")).toBeNull();
    expect(screen.getByText("Work email (suntancity.com only)")).toBeTruthy();
  });

  it("disables the live check in demo mode and says why", () => {
    render(<WovenSyncScreen {...BASE} liveMode={false} missingCredentials={[]} enabled />);
    const button = screen.getByRole("button", { name: /run read-only check/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/demo mode/)).toBeTruthy();
  });

  it("enables the live check only with live mode, the master switch and credentials", () => {
    render(<WovenSyncScreen {...BASE} missingCredentials={[]} enabled />);
    const button = screen.getByRole("button", { name: /run read-only check/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("shows real sync status once the directory exists", () => {
    render(
      <WovenSyncScreen
        {...BASE}
        missingCredentials={[]}
        database={{ state: "ready", status: status({ lastSuccessAt: "2026-10-05T11:31:00Z", unmappedLocations: 1, unreviewedChanges: 4 }) }}
      />,
    );
    expect(screen.getByText("Sync status")).toBeTruthy();
    expect(screen.getAllByText("Oct 5, 6:31 AM").length).toBeGreaterThanOrEqual(1);
  });
});
