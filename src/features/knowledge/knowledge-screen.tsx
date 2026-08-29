"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Ellipsis,
  FileText,
  FolderOpen,
  Info,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { Input, Select } from "@/components/ui/field";
import { DemoDataNote, EmptyState, Notice, SkeletonRows } from "@/components/ui/feedback";
import { PageHeader, PageShell, SectionHeader } from "@/components/ui/layout";
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_CATEGORY_LABEL } from "@/data/demo/knowledge";
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import { formatDate, relativeTime } from "@/lib/utils/date";
import { FILE_TYPE_LABEL, formatBytes, formatNumber, pluralize } from "@/lib/utils/format";
import type { KnowledgeCategory, KnowledgeDocument } from "@/types";
import { DocumentDetail } from "./document-detail";
import { DocumentSourceBadge, DocumentStatusBadge } from "./document-status";
import { UploadDialog } from "./upload-dialog";

export function KnowledgeScreen() {
  const searchParams = useSearchParams();
  const { can } = useSession();
  const { documents, removeDocument, ready } = useAppStore();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<KnowledgeCategory | "all">("all");
  const [uploadCategory, setUploadCategory] = useState<KnowledgeCategory | undefined>();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const canManage = can("manage_knowledge");

  /**
   * Deep links (?document=…, ?upload=1) are derived during render rather than
   * copied into state in an effect. `undefined` means "no local override yet",
   * so the URL wins until the user opens or closes something themselves.
   */
  const [detailOverride, setDetailOverride] = useState<string | null | undefined>();
  const detailId =
    detailOverride === undefined ? searchParams.get("document") : detailOverride;
  const setDetailId = (next: string | null) => setDetailOverride(next);

  const [uploadOverride, setUploadOverride] = useState<boolean | undefined>();
  // The ?upload=1 deep link still respects the permission — a role without
  // manage_knowledge cannot open the upload dialog by editing the URL.
  const uploadOpen =
    canManage &&
    (uploadOverride === undefined
      ? searchParams.get("upload") === "1"
      : uploadOverride);
  const setUploadOpen = (next: boolean) => setUploadOverride(next);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents
      .filter((doc) => (category === "all" ? true : doc.category === category))
      .filter((doc) => {
        if (!q) return true;
        return (
          doc.title.toLowerCase().includes(q) ||
          doc.description.toLowerCase().includes(q) ||
          doc.tags.some((tag) => tag.includes(q)) ||
          doc.fileName.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [documents, query, category]);

  const stats = useMemo(() => {
    const categories = new Set(documents.map((doc) => doc.category));
    return {
      total: documents.length,
      categories: categories.size,
      ready: documents.filter((doc) => doc.status === "ready").length,
      uploads: documents.filter((doc) => doc.source === "upload").length,
    };
  }, [documents]);

  const detailDocument = documents.find((doc) => doc.id === detailId) ?? null;
  const deleteDocument = documents.find((doc) => doc.id === deleteId) ?? null;

  const openUpload = (next?: KnowledgeCategory) => {
    setUploadCategory(next);
    setUploadOpen(true);
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Knowledge"
        title="Knowledge Base"
        description="Every document Sunny answers from. Upload once, and every manager gets the same answer from the same source."
        actions={
          canManage ? (
            <Button onClick={() => openUpload()}>
              <Upload />
              Upload document
            </Button>
          ) : null
        }
      />

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Documents", value: formatNumber(stats.total) },
          { label: "Categories", value: formatNumber(stats.categories) },
          { label: "Indexed & ready", value: formatNumber(stats.ready) },
          { label: "Uploaded here", value: formatNumber(stats.uploads) },
        ].map((entry) => (
          <div
            key={entry.label}
            className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 shadow-soft"
          >
            <p className="eyebrow">{entry.label}</p>
            <p className="mt-1.5 text-[22px] leading-none font-semibold text-foreground tabular-nums">
              {entry.value}
            </p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="documents">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList>
            <TabsTrigger value="documents">All documents</TabsTrigger>
            <TabsTrigger value="libraries">Category libraries</TabsTrigger>
          </TabsList>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search documents…"
                aria-label="Search documents"
                className="pl-9 sm:w-64"
              />
            </div>
            <Select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as KnowledgeCategory | "all")
              }
              aria-label="Filter by category"
              className="sm:w-56"
            >
              <option value="all">All categories</option>
              {KNOWLEDGE_CATEGORIES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <TabsContent value="documents">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[13px] text-muted-foreground">
              {formatNumber(filtered.length)}{" "}
              {pluralize(filtered.length, "document")}
              {category !== "all"
                ? ` in ${KNOWLEDGE_CATEGORY_LABEL[category]}`
                : ""}
              {query.trim() ? ` matching "${query.trim()}"` : ""}
            </p>
            <DemoDataNote />
          </div>

          {!ready ? (
            <SkeletonRows rows={6} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<FileText />}
              title="No documents match"
              description="Try a different search term, or clear the category filter."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {filtered.map((document) => (
                <DocumentRow
                  key={document.id}
                  document={document}
                  canManage={canManage}
                  onOpen={() => setDetailId(document.id)}
                  onDelete={() => setDeleteId(document.id)}
                />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="libraries">
          <Notice tone="neutral" icon={<Info />} className="mb-5">
            Each category behaves like its own small library, with its own
            description and upload point — so a policy never lands in the
            equipment library by accident.
          </Notice>

          <div className="space-y-4">
            {KNOWLEDGE_CATEGORIES.map((entry) => {
              const items = documents.filter((doc) => doc.category === entry.id);
              return (
                <Card key={entry.id}>
                  <CardContent className="p-5">
                    <SectionHeader
                      title={entry.label}
                      description={entry.description}
                      actions={
                        <>
                          <Badge tone="neutral">
                            {formatNumber(items.length)}{" "}
                            {pluralize(items.length, "document")}
                          </Badge>
                          {canManage ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => openUpload(entry.id)}
                            >
                              <Upload />
                              Upload
                            </Button>
                          ) : null}
                        </>
                      }
                      className="mb-3"
                    />

                    {items.length === 0 ? (
                      <p className="rounded-[var(--radius-sm)] border border-dashed border-border-strong px-4 py-5 text-center text-[13px] text-muted-foreground">
                        No documents in this library yet.
                      </p>
                    ) : (
                      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {items.slice(0, 6).map((document) => (
                          <li key={document.id}>
                            <button
                              type="button"
                              onClick={() => setDetailId(document.id)}
                              className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] border border-border px-3 py-2 text-left transition-colors hover:bg-surface-muted"
                            >
                              <FileText
                                className="size-3.5 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                                {document.title}
                              </span>
                              <span className="shrink-0 text-xs text-subtle-foreground">
                                {FILE_TYPE_LABEL[document.fileType]}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {items.length > 6 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2"
                        onClick={() => {
                          setCategory(entry.id);
                          setQuery("");
                        }}
                      >
                        <FolderOpen />
                        View all {items.length}
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Content strategy note */}
      <Notice tone="neutral" icon={<Info />} className="mt-8">
        <p className="font-semibold text-foreground">About this corpus</p>
        <p className="mt-1">
          The seeded set mirrors the focused corpus in use today — roughly 58
          documents across 10 libraries — rather than the full Woven library
          (600+ documents, much of it maintenance and SDS material that should
          not be ingested). SharePoint and Woven sync are not connected in this
          prototype.
        </p>
      </Notice>

      {/* Upload */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open);
          if (!open) setUploadCategory(undefined);
        }}
      >
        <DialogContent
          title="Upload a document"
          description="Add a document to the knowledge library. It is stored in this browser and survives a refresh."
          wide
        >
          <UploadDialog
            defaultCategory={uploadCategory}
            onDone={() => {
              setUploadOpen(false);
              setUploadCategory(undefined);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Detail */}
      <Dialog
        open={Boolean(detailDocument)}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        {detailDocument ? (
          <DialogContent title={detailDocument.title} wide>
            <DocumentDetail document={detailDocument} canManage={canManage} />
          </DialogContent>
        ) : null}
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={Boolean(deleteDocument)}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        {deleteDocument ? (
          <DialogContent
            title="Delete this document?"
            description="It is removed from the knowledge library and Sunny stops citing it."
          >
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">
                {deleteDocument.title}
              </span>{" "}
              and its {deleteDocument.previousVersions.length} earlier{" "}
              {pluralize(deleteDocument.previousVersions.length, "version")} will
              be removed from this browser.
            </p>
            <DialogActions>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={() => {
                  removeDocument(deleteDocument.id);
                  setDeleteId(null);
                }}
              >
                <Trash2 />
                Delete document
              </Button>
            </DialogActions>
          </DialogContent>
        ) : null}
      </Dialog>
    </PageShell>
  );
}

function DocumentRow({
  document,
  canManage,
  onOpen,
  onDelete,
}: {
  document: KnowledgeDocument;
  canManage: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 shadow-soft transition-[border-color,box-shadow]",
          "hover:border-border-strong hover:shadow-raised",
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface-muted text-muted-foreground">
            <FileText className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-[14px] font-medium text-foreground">
                {document.title}
              </span>
              {document.version > 1 ? (
                <Badge tone="neutral" size="sm">
                  v{document.version}
                </Badge>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {KNOWLEDGE_CATEGORY_LABEL[document.category]} ·{" "}
              {FILE_TYPE_LABEL[document.fileType]} ·{" "}
              {formatBytes(document.sizeBytes)} · {document.uploadedBy} ·{" "}
              {formatDate(document.uploadedAt)}
            </span>
          </span>
        </button>

        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <DocumentSourceBadge source={document.source} />
          <DocumentStatusBadge status={document.status} />
          <span className="w-20 text-right text-xs text-subtle-foreground">
            {relativeTime(document.updatedAt)}
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={`Actions for ${document.title}`}
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onOpen}>
              <FileText />
              View details
            </DropdownMenuItem>
            {canManage ? (
              <DropdownMenuItem onSelect={onDelete} tone="danger">
                <Trash2 />
                Delete
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
