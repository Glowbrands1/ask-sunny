// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { WovenSyncPageProps } from "./load";
import { stagesFor, WovenSyncScreen } from "./woven-sync-screen";

/**
 * The Woven Employee Sync screen reports measured state: it says "Waiting on
 * Woven" exactly while credentials are missing, and never shows a credential
 * value or an invented figure.
 */

afterEach(cleanup);

const WAITING: WovenSyncPageProps = {
  enabled: false,
  scheduleEnabled: false,
  missingCredentials: ["WOVEN_SUBSCRIPTION_KEY", "WOVEN_USERNAME", "WOVEN_PASSWORD"],
  database: { state: "not_created" },
};

describe("WovenSyncScreen", () => {
  it("shows Waiting on Woven while credentials are missing, with the built stages", () => {
    render(<WovenSyncScreen {...WAITING} />);
    expect(screen.getAllByText("Waiting on Woven").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Built and tested")).toHaveLength(5);
    expect(screen.getByText("Never copied")).toBeTruthy();
    expect(screen.queryByText("Sync status")).toBeNull();
  });

  it("only one stage is waiting on Woven", () => {
    expect(stagesFor(WAITING).filter((s) => s.state === "waiting")).toHaveLength(1);
  });

  it("stops saying waiting once credentials are configured", () => {
    render(<WovenSyncScreen {...WAITING} missingCredentials={[]} />);
    expect(screen.queryByText("Waiting on Woven")).toBeNull();
    expect(screen.getByText("Woven access is configured")).toBeTruthy();
  });

  it("shows real sync status once the directory exists", () => {
    render(
      <WovenSyncScreen
        {...WAITING}
        missingCredentials={[]}
        scheduleEnabled
        database={{
          state: "ready",
          status: {
            enabled: true,
            scheduleEnabled: true,
            missingCredentials: [],
            problems: [],
            lastSuccessAt: "2026-10-05T11:31:00Z",
            unmappedLocations: 1,
            unreviewedChanges: 4,
            recentRuns: [],
          },
        }}
      />,
    );
    expect(screen.getByText("Sync status")).toBeTruthy();
    expect(screen.getByText("Oct 5, 6:31 AM")).toBeTruthy();
    expect(screen.getAllByText("Complete")).toHaveLength(2);
  });

  it("never renders a credential variable name or value", () => {
    const { container } = render(<WovenSyncScreen {...WAITING} />);
    expect(container.textContent).not.toMatch(/WOVEN_|password|subscription key/i);
  });
});
