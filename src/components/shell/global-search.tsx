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
import { PRODUCTION_SALONS } from "@/data/salons";
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

    /*
      THE PRODUCTION ROSTER, not a seeded one. This used to import
      the retired demo roster, which meant the salon a person searched for came from a
      file named after demo data — and its detail line printed a CITY the
      reporting source does not carry, so a real salon was described with an
      invented one.

      Now: the fifteen production salons, and a detail line built only from
      fields reporting actually holds — the salon number and the district
      manager who runs it.

      STILL UNSCOPED, DELIBERATELY. A restricted user sees that the other
      salons EXIST, by name, and no figure of theirs. That is the company's own
      roster rather than protected reporting data, and whether scope should
      narrow it is a product question that is open with the stakeholder — see
      `global-search-scope.test.ts`, which records the behaviour so a change to
      it shows up in a diff.
    */
    const salonHits: Hit[] = PRODUCTION_SALONS.map((location) => ({
      id: `hit-${location.id}`,
      label: location.name,
      detail: `${location.salonNumber} · ${location.districtName}`,
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
