"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import {
  ChatSyncFailure,
  clearOwnConversations,
  deleteOwnConversation,
  fetchOwnConversations,
  fetchStoredConversationIds,
  saveOwnConversation,
} from "@/lib/chat/client";
import { isClientConversationId } from "@/lib/chat/client-ids";
import { eligibleForImport, importLocalHistory, type ImportSummary } from "@/lib/chat/local-import";
import { mergeConversations } from "@/lib/chat/merge";
import {
  createConversationSync,
  type ConversationSyncStatus,
} from "@/lib/chat/sync";
import { getKnowledgeProvider, getLocalKnowledgeProvider } from "@/lib/knowledge";
import { DEFAULT_PERMISSION_MATRIX } from "@/lib/permissions";
import { getStorageProvider } from "@/lib/storage";
import { nowIso } from "@/lib/utils/date";
import type {
  ChatConversation,
  ChatMessage,
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
  /**
   * Appends turns to a conversation against its CURRENT contents.
   *
   * Not `updateConversation({ messages: [...] })`, which takes a snapshot the
   * caller assembled at some earlier render — see `patchConversationMessage`.
   */
  appendConversationMessages: (id: string, messages: ChatMessage[]) => void;
  /** Patches ONE message against current state. See below. */
  patchConversationMessage: (
    conversationId: string,
    messageId: string,
    patch: Partial<ChatMessage>,
  ) => void;
  /**
   * Removes a conversation from the ACCOUNT and then from this browser.
   *
   * Async because the order matters and the first half can fail — see the
   * implementation. Rejects when the account's copy could not be removed, so
   * the caller can say so rather than showing a deletion that undoes itself on
   * the next load.
   */
  removeConversation: (id: string) => Promise<void>;
  clearConversations: () => Promise<void>;

  /**
   * ==========================================================================
   * SERVER-BACKED HISTORY — THE PART OF THIS STORE THAT IS NO LONGER LOCAL
   * ==========================================================================
   *
   * WHY IT LIVES HERE AND NOT IN THE CHAT SCREEN. Two surfaces create
   * conversations — `chat-screen.tsx` and `use-inline-ask.ts`, the second of
   * which backs the Overview band, the five report ask bars and the Google
   * Reviews bar. Both already write through the mutators above, so persistence
   * hung off those mutators is ONE implementation that both inherit. Two
   * implementations would be two chances to diverge, and the way that failure
   * shows up is a conversation started on the Overview that never appears in
   * History on another device.
   */

  /** True when history is kept on the account rather than only in this browser. */
  accountHistory: boolean;
  /** Per-conversation sync state, for a surface that wants to say "not saved yet". */
  conversationSync: Record<string, ConversationSyncStatus>;
  /** True when at least one conversation gave up trying to save. */
  conversationSyncFailed: boolean;
  /** Re-arm everything that failed. What a "Try again" control calls. */
  retryConversationSync: () => void;

  /**
   * Conversations in THIS BROWSER that are not on the account and could be.
   *
   * Excludes the six seeded demo threads. Empty in demo mode and until
   * hydration has asked the account what it already holds — so the import
   * prompt cannot appear before there is an honest answer to show.
   */
  importableConversations: ChatConversation[];
  /**
   * Bring them over. CALLED ONLY FROM THE IMPORT BUTTON — never on mount,
   * never on sign-in, never from a retry loop nobody started.
   */
  importLocalConversations: () => Promise<ImportSummary>;

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

/**
 * A cheap fingerprint of a conversation's current state.
 *
 * WHAT IT IS FOR: deciding whether a conversation CHANGED, so the sync effect
 * queues the two that did rather than all fifty on every render.
 *
 * WHY THESE TWO FIELDS ARE ENOUGH. Every mutator in this store that touches a
 * conversation moves `updatedAt` — `appendConversationMessages` sets it from
 * the last turn, `patchConversationMessage` sets it to now, and a conversation
 * is created with it. The message count catches the one case a timestamp alone
 * could miss: two writes inside the same millisecond. Titles never change;
 * there is no rename in this product.
 */
function signatureOf(conversation: ChatConversation): string {
  return `${conversation.updatedAt}|${conversation.messages.length}`;
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const storage = useMemo(() => getStorageProvider(), []);
  const [ready, setReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(false);

  const [documents, setDocuments] = useState<KnowledgeDocument[]>(
    DEMO_KNOWLEDGE_DOCUMENTS,
  );
  /*
   * SEEDED IN DEMO MODE ONLY, and the distinction is not cosmetic.
   *
   * In live mode these records were being handed to the Videos screen, which
   * labelled them "added before cloud video storage existed" — false
   * provenance for content nobody ever uploaded. They also reached global
   * search and the Overview counts as though they were the company's real
   * library.
   *
   * The knowledge documents beside this already work this way: seeded for the
   * demo, read from the live source otherwise. Videos now match.
   */
  const [videos, setVideos] = useState<VideoResource[]>(
    DEMO_MODE ? DEMO_VIDEOS : [],
  );
  const [templates, setTemplates] = useState<FormTemplate[]>(DEMO_FORM_TEMPLATES);
  const [forms, setForms] = useState<GeneratedForm[]>(DEMO_GENERATED_FORMS);
  const [conversations, setConversations] =
    useState<ChatConversation[]>(DEMO_CONVERSATIONS);
  const [permissionMatrix, setPermissionMatrixState] = useState<PermissionMatrix>(
    DEFAULT_PERMISSION_MATRIX,
  );

  /* ------------------------------------------------- server-backed chat -- */

  /**
   * Whether history is the account's or only this browser's.
   *
   * Demo mode has no server to keep it on — `assertLiveMode` refuses every
   * chat endpoint there — so the History panel's destructive wording has to say
   * something different, and saying the account-wide sentence in a preview
   * would be a promise the deployment cannot keep.
   */
  const accountHistory = !DEMO_MODE;

  const [conversationSync, setConversationSync] = useState<
    Record<string, ConversationSyncStatus>
  >({});
  const [conversationSyncFailed, setConversationSyncFailed] = useState(false);
  /** Client conversation ids the account already holds. Null until asked. */
  const [storedConversationIds, setStoredConversationIds] = useState<string[] | null>(
    null,
  );

  /**
   * CONVERSATIONS THAT WERE ALREADY IN THIS BROWSER WHEN THE PAGE LOADED.
   *
   * THE MOST IMPORTANT REF IN THIS FILE, because it is what stops a page load
   * from becoming an upload. History that predates server-backed chat is a
   * person's private record on their own device; it goes to the account when
   * they press Import and at no other moment. Everything in this set is
   * therefore excluded from automatic sync — including when the person
   * CONTINUES one of those threads, since syncing it then would send every
   * historical turn in it as a side effect of typing.
   *
   * An id leaves this set exactly once: when an import has brought it over, at
   * which point it is an account conversation like any other and syncs
   * normally.
   *
   * A conversation created after this load is never in the set, so the ordinary
   * service — chat now, read it on your other device — works without anybody
   * being asked anything.
   */
  const historicalIds = useRef<Set<string>>(new Set());

  /**
   * What each conversation looked like the last time it was queued.
   *
   * Primed at hydration for everything already present, which is the second
   * half of the guarantee above: a conversation that has not CHANGED since the
   * page loaded is never queued, so hydration itself writes nothing anywhere.
   */
  const syncedSignatures = useRef<Map<string, string>>(new Map());

  const sync = useMemo(
    () => createConversationSync({ save: saveOwnConversation }),
    [],
  );

  /*
   * The queue owns the state; this only mirrors it into React so a surface can
   * render from it. Reading `sync.statuses()` whole rather than asking per
   * conversation is what lets this subscription bind once, with no ref written
   * during render to tell it which ids exist.
   */
  useEffect(
    () =>
      sync.subscribe(() => {
        setConversationSync(sync.statuses());
        setConversationSyncFailed(sync.hasFailures());
      }),
    [sync],
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
      /*
       * IndexedDB is the demo library. In live mode the canonical library is
       * `training_videos`, read by the Videos screen through GET /api/videos —
       * so nothing stored in this browser is hydrated into live state, and a
       * stale seed cannot resurface as a "legacy upload".
       */
      if (DEMO_MODE && storedVideos.length > 0) setVideos(storedVideos);
      if (storedTemplates.length > 0) setTemplates(storedTemplates);
      if (storedForms.length > 0) setForms(storedForms);
      if (storedConversations.length > 0) setConversations(storedConversations);
      if (storedMatrix) setPermissionMatrixState(storedMatrix);

      /*
       * =====================================================================
       * EVERYTHING ALREADY HERE IS HISTORICAL UNTIL SOMEBODY SAYS OTHERWISE
       * =====================================================================
       *
       * Recorded BEFORE the account is contacted, and before `ready` flips, so
       * the sync effect below cannot queue a single one of them. This is the
       * line that makes "Ask Sunny does not upload your old conversations
       * because you opened a page" a property of the code rather than a
       * promise: automatic sync only ever sees conversations whose signature
       * changed after hydration, and every pre-existing one is primed here with
       * its current signature.
       */
      /*
       * THE EFFECTIVE STARTING SET, which is not always what IndexedDB held.
       *
       * When a browser has stored nothing, React state is still the SEEDED demo
       * conversations — the initial state is `DEMO_CONVERSATIONS` in both modes
       * — so priming from the stored list alone would leave six fabricated
       * threads looking like conversations somebody had just started, and the
       * sync effect would try to send every one of them.
       */
      const startingPoint =
        storedConversations.length > 0 ? storedConversations : DEMO_CONVERSATIONS;
      for (const conversation of startingPoint) {
        historicalIds.current.add(conversation.id);
        syncedSignatures.current.set(conversation.id, signatureOf(conversation));
      }

      setStorageAvailable(true);
      setReady(true);

      /*
       * =====================================================================
       * THE ACCOUNT'S OWN HISTORY, MERGED IN — AND NEVER SUBTRACTED
       * =====================================================================
       *
       * `mergeConversations` is a union, and a failed read does not reach it at
       * all. That ordering is load-bearing: the persist effect below calls
       * `storage.replace()`, which deletes the whole IndexedDB collection and
       * writes back what it is given, so a merge that returned fewer
       * conversations than the browser holds would not merely display less — it
       * would destroy the local copy this phase depends on for rollback.
       *
       * So a Supabase blip, a dropped connection or an expired session leaves
       * local state exactly as it was. The cost is a browser that shows only
       * its own history until the next load, which is the behaviour of the
       * product before this change and is never wrong about anything.
       */
      if (DEMO_MODE) return;

      try {
        const [serverConversations, storedIds] = await Promise.all([
          fetchOwnConversations(),
          fetchStoredConversationIds(),
        ]);
        if (cancelled) return;

        /*
         * A conversation the account already holds is not historical: it is
         * already server-backed, so continuing it should sync like any other.
         */
        for (const id of storedIds) historicalIds.current.delete(id);

        /*
         * PRIMED BEFORE THE STATE WRITE, NOT INSIDE IT. React invokes an
         * updater more than once in development, and this file's own rule is
         * that updaters stay pure — so the signatures for what the account
         * already holds are recorded here, where the values are known and the
         * work happens exactly once.
         *
         * A conversation that the merge CHANGES — local turns unioned with
         * account turns — ends up with a different signature and is therefore
         * queued, which is the correct outcome: the union is news to the
         * account and should reach it.
         */
        for (const conversation of serverConversations) {
          syncedSignatures.current.set(conversation.id, signatureOf(conversation));
        }

        setStoredConversationIds(storedIds);
        setConversations((current) => mergeConversations(current, serverConversations));
      } catch {
        /*
         * Reported by the chat surface as a sync state rather than swallowed
         * into a wrong-looking History. Nothing local is touched.
         */
        if (!cancelled) setStoredConversationIds(null);
      }
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
    // Same rule as knowledge documents: the browser store holds demo content
    // and local UI state, never a copy of the live library.
    if (!DEMO_MODE) return;
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

  /*
   * THE LOCAL COPY IS STILL WRITTEN, AND THAT IS DELIBERATE RATHER THAN LEFTOVER.
   *
   * It is the rollback protection for this whole phase: if server-backed
   * history has to be turned off, this browser still holds everything it ever
   * held, because nothing in this change ever deletes from IndexedDB. It is
   * also what the person is reading when the network is gone.
   */
  useEffect(() => {
    if (!ready) return;
    void storage.replace("chat_conversations", conversations);
  }, [ready, storage, conversations]);

  /**
   * ==========================================================================
   * THE SINGLE SHARED PERSISTENCE PATH
   * ==========================================================================
   *
   * Every surface that can start or continue a conversation — the chat screen,
   * the Overview band, the five report ask bars, the Google Reviews bar —
   * writes through the mutators on this store. So this one effect is the whole
   * of server persistence, and a conversation started on the Overview is saved
   * by exactly the same code as one started on the chat tab. There is no second
   * implementation to drift.
   *
   * THREE THINGS IT WILL NOT QUEUE, and each is a rule rather than an
   * optimisation:
   *
   *   A CONVERSATION THAT HAS NOT CHANGED. Signatures are primed at hydration,
   *   so loading a page queues nothing at all.
   *
   *   A CONVERSATION THAT WAS ALREADY IN THIS BROWSER. Historical history goes
   *   to the account through Import and through nothing else — including when
   *   it is continued, because sending it then would upload every earlier turn
   *   in it as a side effect of typing.
   *
   *   ANY OF THE SIX SEEDED DEMO THREADS. They are in `historicalIds` by virtue
   *   of being present at hydration, and they are refused by the validator and
   *   again by the server. Three independent reasons, because a fabricated
   *   conversation in somebody's real account is not recoverable by apologising.
   */
  useEffect(() => {
    if (!ready || DEMO_MODE) return;

    for (const conversation of conversations) {
      /*
       * THE STRUCTURAL GUARD, and it does not depend on any bookkeeping above
       * being right. An id that `createId` could not have produced is not a
       * conversation this application recorded — the six seeded `conv-seed-*`
       * threads are exactly that — so it is never sent, however it arrived in
       * state. The route refuses them too, and so does the import filter;
       * three independent reasons, because a fabricated conversation in
       * somebody's real account cannot be undone by apologising for it.
       */
      if (!isClientConversationId(conversation.id)) continue;
      if (historicalIds.current.has(conversation.id)) continue;

      const signature = signatureOf(conversation);
      if (syncedSignatures.current.get(conversation.id) === signature) continue;

      syncedSignatures.current.set(conversation.id, signature);
      sync.queue(conversation);
    }
  }, [ready, conversations, sync]);

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

  /**
   * ==========================================================================
   * WRITING ONE MESSAGE WITHOUT REWRITING THE CONVERSATION
   * ==========================================================================
   *
   * THE RACE THIS REPLACES. Callers persisted a message change with
   * `updateConversation(id, { messages: activeConversation.messages.map(...) })`
   * — mapping over an array captured when the callback was created. `setState`
   * itself is functional and safe; the PATCH was not. Any turn added between
   * that capture and the write was silently erased by it.
   *
   * That is not a theoretical window. Creating a form from chat awaits a
   * network call and then an assistant draft that may run for up to two
   * minutes. A manager who types anything in the meantime — which is exactly
   * what someone does while waiting — loses it the moment the form reference
   * lands.
   *
   * So the map runs INSIDE the updater, against whatever the conversation holds
   * at write time. A message that no longer exists is a no-op rather than a
   * resurrection: if the thread was cleared while the request was in flight,
   * the right answer is to write nothing.
   */
  const patchConversationMessage = useCallback(
    (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => {
      setConversations((current) =>
        current.map((conversation) => {
          if (conversation.id !== conversationId) return conversation;
          if (!conversation.messages.some((message) => message.id === messageId)) {
            return conversation;
          }
          return {
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id === messageId ? { ...message, ...patch } : message,
            ),
            updatedAt: new Date().toISOString(),
          };
        }),
      );
    },
    [],
  );

  /**
   * Appends turns against current state, for the same reason.
   *
   * `send` rebuilt the whole array from a `history` snapshot, so a form
   * reference attached while a question was in flight was overwritten by that
   * question's own answer. Appending cannot overwrite anything.
   */
  const appendConversationMessages = useCallback(
    (id: string, messages: ChatMessage[]) => {
      if (messages.length === 0) return;
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === id
            ? {
                ...conversation,
                messages: [...conversation.messages, ...messages],
                updatedAt: messages.at(-1)!.createdAt,
              }
            : conversation,
        ),
      );
    },
    [],
  );

  /**
   * ==========================================================================
   * DELETING MEANS DELETING FROM THE ACCOUNT, NOT JUST FROM THIS SCREEN
   * ==========================================================================
   *
   * THE ACCOUNT GOES FIRST, AND THE LOCAL COPY ONLY FOLLOWS IF IT SUCCEEDED.
   * The other order produces the worst version of this control: the thread
   * vanishes, the person believes it is gone, and the next hydration merges it
   * straight back from the account they could not reach. A delete that undoes
   * itself is worse than one that says it could not run.
   *
   * A 4xx MEANS IT IS NOT ON THE ACCOUNT, which for a delete is success. The
   * server answers "not yours" and "not there" with the same refusal on purpose
   * — it must not become an oracle for which ids exist — and from this side
   * both mean the same thing: there is nothing on the account left to remove,
   * so the local copy can go.
   *
   * A 5xx OR A DROPPED CONNECTION THROWS, and the surface says so. Nothing
   * local is touched.
   */
  const removeConversation = useCallback(
    async (id: string) => {
      if (!DEMO_MODE && !historicalIds.current.has(id)) {
        try {
          await deleteOwnConversation(id);
        } catch (error) {
          if (error instanceof ChatSyncFailure && error.retryable) throw error;
          /* Not on the account. Nothing to remove there; carry on locally. */
        }
      }

      sync.forget(id);
      historicalIds.current.delete(id);
      syncedSignatures.current.delete(id);
      setStoredConversationIds((current) =>
        current === null ? current : current.filter((stored) => stored !== id),
      );
      setConversations((current) => current.filter((entry) => entry.id !== id));
    },
    [sync],
  );

  /**
   * Clear history — the account's copy and this browser's, in that order and
   * for the same reason as a single delete.
   *
   * THE WORDING ON THE CONTROL SAYS SO NOW. "Removes every conversation stored
   * in this browser" stopped being true the moment history existed on the
   * account, and a destructive control that understates what it destroys is the
   * kind of thing somebody discovers by losing something.
   */
  const clearConversations = useCallback(async () => {
    if (!DEMO_MODE) await clearOwnConversations();

    sync.reset();
    historicalIds.current.clear();
    syncedSignatures.current.clear();
    setStoredConversationIds([]);
    setConversations([]);
  }, [sync]);

  const retryConversationSync = useCallback(() => {
    sync.retryFailed();
  }, [sync]);

  /**
   * ==========================================================================
   * WHAT THE IMPORT PROMPT IS ALLOWED TO OFFER
   * ==========================================================================
   *
   * Empty in demo mode, empty until the account has actually been asked what it
   * holds, and never containing a seeded demo thread — `eligibleForImport`
   * refuses those structurally, and the server refuses them again.
   *
   * Empty is also the honest answer while `storedConversationIds` is null,
   * which is what a failed lookup leaves it as: a prompt offering to import
   * conversations that may already be on the account would ask people to
   * approve something nobody can describe correctly.
   */
  const importableConversations = useMemo(() => {
    if (DEMO_MODE || storedConversationIds === null) return [];
    return eligibleForImport(conversations, storedConversationIds);
  }, [conversations, storedConversationIds]);

  /**
   * THE ONLY PATH FROM THIS BROWSER'S OLD HISTORY TO THE ACCOUNT.
   *
   * Reached from the Import button and from nowhere else. It is idempotent and
   * resumable server-side, so pressing it twice, refreshing through it or
   * losing the connection halfway all converge on one conversation with one
   * copy of each turn.
   *
   * NOTHING LOCAL IS DELETED BY A SUCCESSFUL IMPORT. The browser's copy stays
   * exactly where it is as rollback protection, which is why this only moves
   * ids out of `historicalIds` — from here on those threads are account
   * conversations and sync like any other.
   */
  const importLocalConversations = useCallback(async () => {
    const candidates = importableConversations;
    if (candidates.length === 0) {
      return { imported: [], declined: [], error: null } satisfies ImportSummary;
    }

    const summary = await importLocalHistory(candidates);

    for (const id of summary.imported) {
      historicalIds.current.delete(id);
    }
    if (summary.imported.length > 0) {
      setStoredConversationIds((current) => [...(current ?? []), ...summary.imported]);
    }

    return summary;
  }, [importableConversations]);

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
    /*
     * THE RESTORED SEED SET IS MARKED HISTORICAL, so the chat sync effect
     * cannot mistake six fabricated threads reappearing for six conversations
     * somebody just had. The control is gated on demo mode in `UserMenu` and
     * the effect is gated on it too, so this is the third independent reason
     * `conv-seed-*` never reaches Supabase — which is the right number for
     * something that cannot be undone by apologising.
     */
    for (const conversation of DEMO_CONVERSATIONS) {
      historicalIds.current.add(conversation.id);
      syncedSignatures.current.set(conversation.id, signatureOf(conversation));
    }
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
      appendConversationMessages,
      patchConversationMessage,
      removeConversation,
      clearConversations,
      accountHistory,
      conversationSync,
      conversationSyncFailed,
      retryConversationSync,
      importableConversations,
      importLocalConversations,
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
      appendConversationMessages,
      patchConversationMessage,
      removeConversation,
      clearConversations,
      accountHistory,
      conversationSync,
      conversationSyncFailed,
      retryConversationSync,
      importableConversations,
      importLocalConversations,
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
