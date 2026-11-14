// Copied from the Leadership Hub (src/app/meetings/_components/SharedFiles.tsx); keep in step with it. See src/features/l10/README.md.
"use client";

import { useRef, useState } from "react";
import { Button, cx } from "@/features/l10/ui/ui";
import { L10_FILE_ACCEPT, extensionOf, formatBytes, isLegacyFile, looksLike, validateL10Upload, type L10FileError } from "@/features/l10/lib/files";
import type { IssueFile } from "@/features/l10/lib/types";
import { finishL10Upload, openL10File, prepareL10Upload, putFixtureL10File } from "@/features/l10/files-actions";

type Note = { tone: "ok" | "error" | "info"; text: string; link?: { href: string; label: string } };

/**
 * Files attached to one issue. Attach (PDF, Word, Excel, PNG or JPG, up to 25 MB), list, open (a link that works for one
 * hour, made only for people in this meeting) and remove. Removing only takes the file off the issue: the stored copy is
 * kept. The list is saved with the meeting like the rest of the issue.
 */
export function SharedFiles({ meetingKey: keyProp, issueId, files, onChange }: { meetingKey?: string; issueId: string; files: IssueFile[]; onChange: (update: (files: IssueFile[]) => IssueFile[]) => void }) {
  // The page is /meetings/<key>. MeetingView may pass the key; until it does, it is read from the address when needed.
  const meetingKey = () => keyProp || window.location.pathname.split("/").filter(Boolean)[1] || "";
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const problem = (e: L10FileError) => setNote({ tone: e.kind === "missing" ? "info" : "error", text: e.message });

  const attach = async (list: FileList | null) => {
    const picked = list ? Array.from(list) : [];
    if (picked.length === 0) return;
    setNote(null);
    let added = 0;
    for (const file of picked) {
      setBusy(`Uploading ${file.name}…`);
      try {
        const bad = validateL10Upload(file.name, file.size);
        if (bad) {
          setNote({ tone: "error", text: `${file.name}: ${bad.message}` });
          continue;
        }
        const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
        if (!looksLike(extensionOf(file.name) === "jpeg" ? "jpg" : (extensionOf(file.name) ?? ""), head)) {
          setNote({ tone: "error", text: `${file.name} does not look like a real ${(extensionOf(file.name) ?? "").toUpperCase()} file, so it was not attached.` });
          continue;
        }
        const prep = await prepareL10Upload({ key: meetingKey(), issueId, name: file.name, size: file.size });
        if (!prep.ok) {
          setNote({ tone: "error", text: `${file.name}: ${prep.error.message}` });
          continue;
        }
        if (prep.data.mode === "fixture") {
          const form = new FormData();
          form.append("path", prep.data.path);
          form.append("file", file);
          const put = await putFixtureL10File(form);
          if (!put.ok) {
            setNote({ tone: "error", text: `${file.name}: ${put.error.message}` });
            continue;
          }
        } else {
          // From here straight to Storage: the app never receives the bytes.
          const body = new FormData();
          body.append("cacheControl", "3600");
          body.append("", new Blob([file], { type: prep.data.contentType }));
          const res = await fetch(prep.data.signedUrl, { method: "PUT", body, headers: { "x-upsert": "false" } });
          if (!res.ok) {
            setNote({
              tone: "error",
              text:
                res.status === 413
                  ? `${file.name} is larger than 25 MB.`
                  : res.status === 401 || res.status === 403
                    ? "You do not have permission to add files to this meeting."
                    : `${file.name} could not be uploaded. Nothing was attached; try again in a moment.`,
            });
            continue;
          }
        }
        const done = await finishL10Upload({ key: meetingKey(), issueId, path: prep.data.path, name: file.name });
        if (!done.ok) {
          setNote({ tone: "error", text: `${file.name}: ${done.error.message}` });
          continue;
        }
        onChange((xs) => [...xs, done.data]);
        added += 1;
      } catch {
        setNote({ tone: "error", text: `${file.name} could not be uploaded. Nothing was attached; check your connection and try again.` });
      }
    }
    setBusy(null);
    if (input.current) input.current.value = "";
    if (added > 0) setNote((n) => n ?? { tone: "ok", text: added === 1 ? "File attached. It is saved with the meeting." : `${added} files attached. They are saved with the meeting.` });
  };

  const open = async (f: IssueFile) => {
    setNote(null);
    setBusy(`Opening ${f.name}…`);
    try {
      const r = await openL10File({ key: meetingKey(), path: f.path, name: f.name });
      if (!r.ok) {
        problem(r.error);
        return;
      }
      let href: string;
      if (r.data.kind === "url") {
        href = r.data.url;
      } else {
        const bytes = Uint8Array.from(atob(r.data.base64), (c) => c.charCodeAt(0));
        href = URL.createObjectURL(new Blob([bytes], { type: r.data.mime }));
      }
      window.open(href, "_blank", "noopener,noreferrer");
      // A browser that blocks the new tab gives no sign, so say what to do instead of leaving the click looking dead.
      setNote({ tone: "info", text: `${f.name}: if it did not open, your browser may have blocked the new tab.`, link: { href, label: "Open it here" } });
    } catch {
      setNote({ tone: "error", text: "The file could not be opened. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  };

  const remove = (f: IssueFile) => {
    onChange((xs) => xs.filter((x) => x.path !== f.path));
    setConfirming(null);
    setNote({ tone: "info", text: `${f.name} was taken off this issue. The stored copy is kept.` });
  };

  return (
    <div className="border-t border-rule pt-3 text-sm" data-testid="shared-files">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold text-muted">Shared files ({files.length})</div>
        <div className="flex items-center gap-2">
          <input ref={input} type="file" multiple accept={L10_FILE_ACCEPT} aria-label="Attach files to this issue" className="sr-only" data-testid="shared-files-input" onChange={(e) => void attach(e.target.files)} />
          <Button variant="outline" disabled={busy !== null} onClick={() => input.current?.click()}>
            Attach file
          </Button>
        </div>
      </div>
      <p className="m-0 mb-2 text-xs text-muted">PDF, Word, Excel, PNG or JPG, up to 25 MB. Everyone in this meeting can open them; links work for one hour.</p>
      {busy && (
        <div role="status" className="mb-2 text-xs font-semibold" data-testid="shared-files-busy">
          {busy}
        </div>
      )}
      {note && (
        <div
          role={note.tone === "error" ? "alert" : "status"}
          data-testid="shared-files-note"
          data-tone={note.tone}
          className={cx("mb-2 rounded-md border p-2 text-xs", note.tone === "error" ? "border-[#8a1c1c] text-[#8a1c1c]" : "border-line text-ink")}
        >
          {note.text}
          {note.link && (
            <>
              {" "}
              <a href={note.link.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-bronze-deep underline">
                {note.link.label}
              </a>
            </>
          )}
        </div>
      )}
      {files.length === 0 ? (
        <p className="m-0 text-muted">No files on this issue yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {files.map((f) => (
            <li key={f.path} className="flex flex-wrap items-center gap-2" data-testid="shared-file">
              <span className="min-w-0 flex-1 break-words">
                {f.name}
                <span className="text-xs text-muted">
                  {typeof f.size === "number" ? ` · ${formatBytes(f.size)}` : ""}
                  {f.uploadedBy ? ` · ${f.uploadedBy}` : ""}
                </span>
              </span>
              {isLegacyFile(f) ? (
                <span className="text-xs text-muted" data-testid="shared-file-legacy">
                  Old file from the previous app, attach it again
                </span>
              ) : (
                <Button variant="outline" aria-label={`Open ${f.name}`} disabled={busy !== null} onClick={() => void open(f)}>
                  Open
                </Button>
              )}
              {confirming === f.path ? (
                <>
                  <Button variant="outline" className="text-[#8a1c1c]" aria-label={`Confirm remove ${f.name}`} onClick={() => remove(f)}>
                    Yes, remove
                  </Button>
                  <Button variant="outline" onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button variant="outline" aria-label={`Remove ${f.name}`} onClick={() => setConfirming(f.path)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
