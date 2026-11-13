import type { ReactNode } from "react";

import { leadershipHubUrl } from "@/lib/config/app-switcher";
import { AssistantBubble } from "./assistant/AssistantBubble";
import { jetBrainsMono, publicSans } from "@/app/fonts";
import { NotificationBell } from "./ui/NotificationBell";

/** This meeting's page in the Leadership Hub (absolute). */
export function hubMeetingUrl(key: string, path = ""): string {
  return `${leadershipHubUrl()}/meetings/${encodeURIComponent(key)}${path}`;
}

/**
 * The DM L10 pages' frame: the Leadership Hub's look (scoped by `.hub-l10`, see the DM L10 section of globals.css) and its slim meeting bar,
 * which in the Hub carries "← Leadership Hub", the bell and the app links. Here the link opens this meeting in the
 * Hub, the bell is the same notes and read state as the Hub's, and the assistant bubble sits bottom right as there.
 */
export function L10Frame({ meetingKey, children, assistant = true }: { meetingKey: string; children: ReactNode; assistant?: boolean }) {
  const hub = leadershipHubUrl();
  return (
    <div data-testid="l10-frame" className={`hub-l10 ${publicSans.variable} ${jetBrainsMono.variable} flex min-h-full flex-col antialiased`}>
      <div className="meeting-bar box-border flex items-center bg-ink px-4 py-1 text-sm text-paper print:hidden">
        <a href={hubMeetingUrl(meetingKey)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center font-semibold text-gold hover:text-gold-hover">
          ← Leadership Hub
        </a>
        <span className="ml-auto flex items-center gap-3">
          <NotificationBell hubUrl={hub} />
        </span>
      </div>
      <div className="box-border flex min-w-0 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-7 lg:px-8">{children}</div>
      {assistant && <AssistantBubble meetingKey={meetingKey} />}
    </div>
  );
}
