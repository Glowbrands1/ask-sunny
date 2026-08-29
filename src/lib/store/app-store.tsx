"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  DEMO_CONVERSATIONS,
  DEMO_FORM_TEMPLATES,
  DEMO_GENERATED_FORMS,
  DEMO_KNOWLEDGE_DOCUMENTS,
  DEMO_VIDEOS,
} from "@/data/demo";
import { isDemoMode } from "@/lib/config/runtime";
import { getKnowledgeProvider, getLocalKnowledgeProvider } from "@/lib/knowledge";
import { DEFAULT_PERMISSION_MATRIX } from "@/lib/permissions";
import { getStorageProvider } from "@/lib/storage";
import { nowIso } from "@/lib/utils/date";
import type {
  ChatConversation,
  FormTemplate,
  GeneratedForm,
  KnowledgeDocument,
  PermissionMatrix,
  VideoResource,
} from "@/types";

/**
 * The prototype's mutable application state.
 *
 * Initial state is always the seeded demo content, which makes the server and
 * the first client render identical. After mount the provider hydrates from
 * IndexedDB through the StorageProvider, so uploads, edits, saved forms and
 * permission changes survive a page refresh on the demo machine.
 *
 * Persistence is handled by dedicated sync effects rather than by writing
 * inside state updaters: updaters must stay pure (React invokes them more than
 * once in development), and "keep an external system in step with React state"
 * is precisely what an effect is for.
 *
 * Every write goes through the StorageProvider interface — never through a
 * storage client directly — so pointing this at Supabase later is a change in
 * `lib/storage/index.ts` and nowhere else.
 */

interface AppStoreValue {
  /** True once IndexedDB hydration has finished (or been ruled out). */
  ready: boolean;
  storageAvailable: boolean;

  documents: KnowledgeDocument[];
  videos: VideoResource[];
  templates: FormTemplate[];
  forms: GeneratedForm[];
  conversations: ChatConversation[];
  permissionMatrix: PermissionMatrix;

  addDocument: (document: KnowledgeDocument, file?: File) => Promise<void>;
  updateDocument: (id: string, patch: Partial<KnowledgeDocument>) => void;
  removeDocument: (id: string) => void;

  addVideo: (video: VideoResource) => void;
  updateVideo: (id: string, patch: Partial<VideoResource>) => void;
  removeVideo: (id: string) => void;

  saveForm: (form: GeneratedForm) => void;
  updateForm: (id: string, patch: Partial<GeneratedForm>) => void;
  removeForm: (id: string) => void;

  updateTemplate: (id: string, patch: Partial<FormTemplate>) => void;

  addConversation: (conversation: ChatConversation) => void;
  updateConversation: (id: string, patch: Partial<ChatConversation>) => void;
  removeConversation: (id: string) => void;
  clearConversations: () => void;

  setPermissionMatrix: (matrix: PermissionMatrix) => void;

  resetDemoData: () => Promise<void>;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

const PERMISSION_KEY = "permission-matrix";

/**
 * Read once at module scope: NEXT_PUBLIC_DEMO_MODE is inlined at build time, so
 * it cannot change between the server render and the client render. Reading it
 * inside a render would invite a hydration mismatch for no benefit.
 */
const DEMO_MODE = isDemoMode();

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const storage = useMemo(() => getStorageProvider(), []);
  const [ready, setReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(false);

  const [documents, setDocuments] = useState<KnowledgeDocument[]>(
    DEMO_KNOWLEDGE_DOCUMENTS,
  );
  const [videos, setVideos] = useState<VideoResource[]>(DEMO_VIDEOS);
  const [templates, setTemplates] = useState<FormTemplate[]>(DEMO_FORM_TEMPLATES);
  const [forms, setForms] = useState<GeneratedForm[]>(DEMO_GENERATED_FORMS);
  const [conversations, setConversations] =
    useState<ChatConversation[]>(DEMO_CONVERSATIONS);
  const [permissionMatrix, setPermissionMatrixState] = useState<PermissionMatrix>(
    DEFAULT_PERMISSION_MATRIX,
  );

  /* ------------------------------------------------------------ hydrate -- */
  useEffect(() => {
    // No "already ran" ref guard here on purpose: React StrictMode mounts,
    // unmounts and remounts in development. A ref guard would let the first
    // pass be cancelled by its own cleanup and then skip the second pass
    // entirely, so nothing stored would ever be applied. Re-running is safe:
    // every read is idempotent.
    let cancelled = false;

    async function hydrate() {
      if (!storage.isAvailable()) {
        if (!cancelled) {
          setStorageAvailable(false);
          setReady(true);
        }
        return;
      }

      const [
        storedDocuments,
        storedVideos,
        storedTemplates,
        storedForms,
        storedConversations,
        storedMatrix,
      ] = await Promise.all([
        storage.list<KnowledgeDocument>("knowledge_documents"),
        storage.list<VideoResource>("videos"),
        storage.list<FormTemplate>("form_templates"),
        storage.list<GeneratedForm>("generated_forms"),
        storage.list<ChatConversation>("chat_conversations"),
        storage.getValue<PermissionMatrix>(PERMISSION_KEY),
      ]);

      if (cancelled) return;

      // An empty collection means nothing has been stored on this machine yet;
      // the seeded set already in state is written out by the sync effects
      // below as soon as `ready` flips.
      // In live mode the knowledge library lives in Postgres, not in this
      // browser. A stale IndexedDB copy must not shadow it: a document the
      // server has not indexed is a document Sunny cannot cite, and showing it
      // as present would be a lie.
      if (DEMO_MODE) {
        if (storedDocuments.length > 0) setDocuments(storedDocuments);
      } else {
        try {
          const live = await getKnowledgeProvider().listDocuments();
          if (!cancelled) setDocuments(live);
        } catch {
          // Reported by the Knowledge Base screen rather than silently
          // replaced with seeded content.
          if (!cancelled) setDocuments([]);
        }
      }
      if (storedVideos.length > 0) setVideos(storedVideos);
      if (storedTemplates.length > 0) setTemplates(storedTemplates);
      if (storedForms.length > 0) setForms(storedForms);
      if (storedConversations.length > 0) setConversations(storedConversations);
      if (storedMatrix) setPermissionMatrixState(storedMatrix);

      setStorageAvailable(true);
      setReady(true);
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [storage]);

  /* ------------------------------------------------------------ persist -- */
  // One effect per collection: whenever React state changes, the browser store
  // is brought back in step. Guarded on `ready` so seeded state never
  // overwrites what is already stored before hydration has read it.
  useEffect(() => {
    if (!ready) return;
    // Confidential company documents are not copied into browser storage in
    // live mode; IndexedDB holds demo content and local UI state only.
    if (!DEMO_MODE) return;
    void storage.replace("knowledge_documents", documents);
  }, [ready, storage, documents]);

  useEffect(() => {
    if (!ready) return;
    void storage.replace("videos", videos);
  }, [ready, storage, videos]);

  useEffect(() => {
    if (!ready) return;
    void storage.replace("form_templates", templates);
  }, [ready, storage, templates]);

  useEffect(() => {
    if (!ready) return;
    void storage.replace("generated_forms", forms);
  }, [ready, storage, forms]);

  useEffect(() => {
    if (!ready) return;
    void storage.replace("chat_conversations", conversations);
  }, [ready, storage, conversations]);

  useEffect(() => {
    if (!ready) return;
    void storage.setValue(PERMISSION_KEY, permissionMatrix);
  }, [ready, storage, permissionMatrix]);

  /*
   * Keep the seeded retriever aware of uploads so demo chat can cite them.
   * This targets the local provider by name because it is a demo-only concern:
   * in live mode retrieval happens server-side over indexed chunks.
   */
  useEffect(() => {
    if (!DEMO_MODE) return;
    getLocalKnowledgeProvider().setDocuments(documents);
  }, [documents]);

  /* -------------------------------------------------------------- writes -- */

  const addDocument = useCallback(
    async (document: KnowledgeDocument, file?: File) => {
      if (file && document.blobKey) {
        await storage.putBlob(document.blobKey, file, {
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          createdAt: nowIso(),
        });
      }

      setDocuments((current) => {
        // Same title = a new version that supersedes the previous entry.
        const existing = current.find(
          (entry) =>
            entry.title.trim().toLowerCase() === document.title.trim().toLowerCase(),
        );

        if (!existing) return [document, ...current];

        const superseded: KnowledgeDocument = {
          ...document,
          id: existing.id,
          version: existing.version + 1,
          previousVersions: [
            ...existing.previousVersions,
            {
              version: existing.version,
              uploadedAt: existing.uploadedAt,
              uploadedBy: existing.uploadedBy,
              sizeBytes: existing.sizeBytes,
              note: "Superseded by a newer upload",
            },
          ],
        };
        return current.map((entry) =>
          entry.id === existing.id ? superseded : entry,
        );
      });
    },
    [storage],
  );

  const updateDocument = useCallback(
    (id: string, patch: Partial<KnowledgeDocument>) => {
      setDocuments((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
      );
    },
    [],
  );

  const removeDocument = useCallback(
    (id: string) => {
      const target = documents.find((entry) => entry.id === id);
      if (target?.blobKey) void storage.removeBlob(target.blobKey);
      setDocuments((current) => current.filter((entry) => entry.id !== id));
    },
    [documents, storage],
  );

  const addVideo = useCallback((video: VideoResource) => {
    setVideos((current) => [video, ...current]);
  }, []);

  const updateVideo = useCallback((id: string, patch: Partial<VideoResource>) => {
    setVideos((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }, []);

  const removeVideo = useCallback((id: string) => {
    setVideos((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const saveForm = useCallback((form: GeneratedForm) => {
    setForms((current) => {
      const exists = current.some((entry) => entry.id === form.id);
      return exists
        ? current.map((entry) => (entry.id === form.id ? form : entry))
        : [form, ...current];
    });
  }, []);

  const updateForm = useCallback((id: string, patch: Partial<GeneratedForm>) => {
    setForms((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }, []);

  const removeForm = useCallback((id: string) => {
    setForms((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const updateTemplate = useCallback((id: string, patch: Partial<FormTemplate>) => {
    setTemplates((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }, []);

  const addConversation = useCallback((conversation: ChatConversation) => {
    setConversations((current) => [conversation, ...current]);
  }, []);

  const updateConversation = useCallback(
    (id: string, patch: Partial<ChatConversation>) => {
      setConversations((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
      );
    },
    [],
  );

  const removeConversation = useCallback((id: string) => {
    setConversations((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const clearConversations = useCallback(() => {
    setConversations([]);
  }, []);

  const setPermissionMatrix = useCallback((matrix: PermissionMatrix) => {
    setPermissionMatrixState(matrix);
  }, []);

  const resetDemoData = useCallback(async () => {
    await storage.clearAll();
    setDocuments(DEMO_KNOWLEDGE_DOCUMENTS);
    setVideos(DEMO_VIDEOS);
    setTemplates(DEMO_FORM_TEMPLATES);
    setForms(DEMO_GENERATED_FORMS);
    setConversations(DEMO_CONVERSATIONS);
    setPermissionMatrixState(DEFAULT_PERMISSION_MATRIX);
    // The sync effects above write the restored seed set straight back out.
  }, [storage]);

  const value = useMemo<AppStoreValue>(
    () => ({
      ready,
      storageAvailable,
      documents,
      videos,
      templates,
      forms,
      conversations,
      permissionMatrix,
      addDocument,
      updateDocument,
      removeDocument,
      addVideo,
      updateVideo,
      removeVideo,
      saveForm,
      updateForm,
      removeForm,
      updateTemplate,
      addConversation,
      updateConversation,
      removeConversation,
      clearConversations,
      setPermissionMatrix,
      resetDemoData,
    }),
    [
      ready,
      storageAvailable,
      documents,
      videos,
      templates,
      forms,
      conversations,
      permissionMatrix,
      addDocument,
      updateDocument,
      removeDocument,
      addVideo,
      updateVideo,
      removeVideo,
      saveForm,
      updateForm,
      removeForm,
      updateTemplate,
      addConversation,
      updateConversation,
      removeConversation,
      clearConversations,
      setPermissionMatrix,
      resetDemoData,
    ],
  );

  return (
    <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
  );
}

export function useAppStore(): AppStoreValue {
  const context = useContext(AppStoreContext);
  if (!context) {
    throw new Error("useAppStore must be used inside AppStoreProvider");
  }
  return context;
}
