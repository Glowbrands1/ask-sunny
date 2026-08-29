"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  FileStack,
  FileText,
  LayoutDashboard,
  MapPin,
  Video as VideoIcon,
} from "lucide-react";

import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/feedback";
import { DEMO_LOCATIONS } from "@/data/demo/locations";
import { KNOWLEDGE_CATEGORY_LABEL } from "@/data/demo/knowledge";
import { VIDEO_CATEGORY_LABEL } from "@/data/demo/videos";
import { useAppStore } from "@/lib/store/app-store";
import { NAV_SECTIONS } from "./navigation";

interface Hit {
  id: string;
  label: string;
  detail: string;
  href: string;
  kind: "screen" | "document" | "video" | "form" | "salon";
}

const ICON = {
  screen: LayoutDashboard,
  document: FileText,
  video: VideoIcon,
  form: FileStack,
  salon: MapPin,
};

const KIND_LABEL = {
  screen: "Screen",
  document: "Document",
  video: "Video",
  form: "Form",
  salon: "Salon",
};

export function GlobalSearch() {
  const { documents, videos, forms } = useAppStore();
  const [query, setQuery] = useState("");

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    const screens: Hit[] = NAV_SECTIONS.flatMap((section) =>
      section.items.map((item) => ({
        id: `screen-${item.href}`,
        label: item.label,
        detail: section.label,
        href: item.href,
        kind: "screen" as const,
      })),
    );

    const docHits: Hit[] = documents.map((doc) => ({
      id: `doc-${doc.id}`,
      label: doc.title,
      detail: KNOWLEDGE_CATEGORY_LABEL[doc.category],
      href: `/knowledge?document=${doc.id}`,
      kind: "document" as const,
    }));

    const videoHits: Hit[] = videos.map((video) => ({
      id: `vid-${video.id}`,
      label: video.title,
      detail: VIDEO_CATEGORY_LABEL[video.category],
      href: `/videos?video=${video.id}`,
      kind: "video" as const,
    }));

    const formHits: Hit[] = forms.map((form) => ({
      id: `form-${form.id}`,
      label: `${form.employeeName} — ${form.templateName}`,
      detail: form.locationName,
      href: `/forms/monitoring?form=${form.id}`,
      kind: "form" as const,
    }));

    const salonHits: Hit[] = DEMO_LOCATIONS.map((location) => ({
      id: `loc-${location.id}`,
      label: location.name,
      detail: `${location.city}, ${location.state} · ${location.districtName}`,
      href: `/reviews?location=${location.id}`,
      kind: "salon" as const,
    }));

    return [...screens, ...docHits, ...videoHits, ...formHits, ...salonHits]
      .filter(
        (hit) =>
          hit.label.toLowerCase().includes(q) || hit.detail.toLowerCase().includes(q),
      )
      .slice(0, 24);
  }, [query, documents, videos, forms]);

  return (
    <div>
      <Input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search documents, videos, forms, salons…"
        aria-label="Search Ask Sunny"
      />

      <div className="mt-4">
        {query.trim().length < 2 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            Type at least two characters to search.
          </p>
        ) : hits.length === 0 ? (
          <EmptyState
            compact
            title="No matches"
            description={`Nothing in the knowledge base, video library, forms or salons matches "${query.trim()}".`}
          />
        ) : (
          <ul className="space-y-1">
            {hits.map((hit) => {
              const Icon = ICON[hit.kind];
              return (
                <li key={hit.id}>
                  <Link
                    href={hit.href}
                    className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-2 transition-colors hover:bg-surface-muted"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-xs)] bg-surface-muted text-muted-foreground">
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {hit.label}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {hit.detail}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-subtle-foreground">
                      {KIND_LABEL[hit.kind]}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
