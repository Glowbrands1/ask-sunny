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

import { isDemoMode } from "@/lib/config/runtime";
import {
  ChatSyncFailure,
  clearOwnConversations,
  deleteOwnConversation,
  fetchHistoryState,
  fetchOwnConversations,
  saveOwnConversation,
} from "@/lib/chat/client";
import { isClientConversationId } from "@/lib/chat/client-ids";
import {
  eligibleForImport,
  importLocalHistory,
  type ImportSummary,
} from "@/lib/chat/local-import";
import { mergeConversations } from "@/lib/chat/merge";
import { isSuppressed, suppressDeleted, type HistoryState } from "@/lib/chat/suppression";
import { createConversationSync, type ConversationSyncStatus } from "@/lib/chat/sync";
import { demoRuntime } from "@/lib/demo/runtime";
import { purgeDemoRecords, withoutDemoRecords } from "./purge-demo-records";
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

  /*
   * ==========================================================================
   * EVERY SEED IS DEMO-MODE ONLY. LIVE STARTS EMPTY.
   * ==========================================================================
   *
   * Four of these five used to be seeded unconditionally, and each leaked
   * somewhere different on a live deployment:
   *
   *   documents  seeded the Knowledge Base and the Ask band's "Reading N
   *              documents in your knowledge base" until the async live read
   *              finished, so the first paint counted a library nobody owned.
   *   forms      reached Global Search, which offered a manager fabricated
   *              coaching and policy-review records for invented employees —
   *              Jane Kowalski, Marcus Trent — linking into real Form
   *              Monitoring URLs.
   *   templates  rendered nowhere today, and was still written to the browser
   *              store, waiting for the first consumer to inherit it.
   *   conversations seeded the chat history sidebar with two invented threads,
   *              one of them answering a Daily Stats question with invented
   *              figures.
   *
   * `videos` was already correct and is the pattern the other four now follow.
   * An empty array in live mode is not a worse starting point than seeded
   * content — it is the honest one, and every screen already has an empty
   * state for it, because every screen has to handle a genuinely empty account.
   *
   * ==========================================================================
   * AND NOW EVERY COLLECTION STARTS EMPTY, IN BOTH MODES
   * ==========================================================================
   *
   * A `DEMO_MODE ? SEED : []` initialiser still needed a STATIC import of the
   * seed, and a static import ships. The runtime gate was correct and the
   * bytes went out anyway: `conv-seed-1`, `Jane Kowalski` and the rest were
   * in production JavaScript, downloaded by managers and then discarded.
   *
   * So the seeds are fetched instead, by the hydrate effect below, through a
   * dynamic `import()` that only demo mode reaches. The cost is that demo
   * content arrives one tick after first paint, which is the correct trade:
   * the demo waits a frame so production never carries the payload.
   */
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
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
  const [videos, setVideos] = useState<VideoResource[]>([]);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [forms, setForms] = useState<GeneratedForm[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
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
  /**
   * WHAT THE ACCOUNT SAYS ABOUT THIS PERSON'S HISTORY — and null until it has
   * been asked, or when the asking failed.
   *
   * NULL SUPPRESSES NOTHING. An outage must never be able to imitate a delete,
   * so a browser that could not reach the account shows its local history
   * exactly as it was, offers no import, and removes nothing. See the state
   * machine in `lib/chat/suppression.ts`.
   */
  const [historyState, setHistoryState] = useState<HistoryState | null>(null);

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
      /*
       * ====================================================================
       * THE SEEDS, FETCHED RATHER THAN BUNDLED — AND BEFORE ANYTHING ELSE
       * ====================================================================
       *
       * `import()` inside the branch, so the whole of `data/demo` is a chunk
       * a live deployment never requests. This is what actually keeps seeded
       * records out of production JavaScript: the `DEMO_MODE` conditionals
       * elsewhere decide what RENDERS, and only this decides what SHIPS.
       *
       * ABOVE THE STORAGE GUARD, WHICH IS NOT A DETAIL. This first sat after
       * the stored reads, and the early return below meant that a browser
       * with IndexedDB unavailable — a private window, blocked site data, a
       * jsdom test — got demo mode with no demo content at all. The seed does
       * not depend on storage and must not be gated behind it.
       *
       * The stored reads below still win: they run after this and overwrite
       * anything this browser has actually saved.
       */
      if (DEMO_MODE) {
        const demo = await demoRuntime.loadSeeds();
        if (cancelled) return;
        /*
         * SEEDED ONLY WHERE NOTHING IS THERE YET, and this is not caution —
         * it is a correctness fix the test suite caught. The seed now arrives
         * asynchronously, so a manager can ask a question before it lands;
         * assigning unconditionally overwrote the conversation they had just
         * started with the seeded pair, and their turn vanished mid-answer.
         *
         * The updater form rather than a check on the current closure value:
         * these run in one batch and each must see the state as it is at the
         * moment it applies, not as it was when the import began.
         */
        const seedIfEmpty =
          <T,>(seed: T[]) =>
          (current: T[]) =>
            current.length > 0 ? current : seed;

        setDocuments(seedIfEmpty([...demo.documents]));
        setVideos(seedIfEmpty([...demo.videos]));
        setTemplates(seedIfEmpty([...demo.templates]));
        setForms(seedIfEmpty([...demo.forms]));
        setConversations(seedIfEmpty([...demo.conversations]));
      }

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

      /*
       * ====================================================================
       * REMOVE SEEDED RECORDS THIS BROWSER WAS GIVEN BY AN EARLIER BUILD
       * ====================================================================
       *
       * Turning the seeds off above only helps a browser that has never run
       * this app. Every browser that HAS already holds them, because the
       * store used to write its seeded state out unguarded — so without this,
       * the reads below would hand the demo content straight back and the fix
       * would appear to have done nothing.
       *
       * BEFORE THE READS ARE USED, not after: `storedConversations` was
       * fetched in the batch above and still contains the seeded pair, so the
       * purge result has to be applied to it as well as to the store.
       *
       * Exact ids only, from the seed constants — see `purge-demo-records.ts`
       * for why no real record can be caught by it.
       */
      if (!DEMO_MODE) {
        await purgeDemoRecords(storage);
        if (cancelled) return;
      }

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
      /*
       * `withoutDemoRecords` on each, because the lists above were read before
       * the purge ran and still carry whatever it removed. The store and this
       * state have to agree: a seeded conversation left in state here would be
       * written straight back out by the persist effect below, undoing the
       * purge on the very same load.
       *
       * In demo mode it is a no-op with no seeded rows to drop, because the
       * purge did not run and the seeds are the intended content.
       */
      const liveTemplates = DEMO_MODE ? storedTemplates : withoutDemoRecords(storedTemplates);
      const liveForms = DEMO_MODE ? storedForms : withoutDemoRecords(storedForms);
      const liveConversations = DEMO_MODE
        ? storedConversations
        : withoutDemoRecords(storedConversations);

      if (liveTemplates.length > 0) setTemplates(liveTemplates);
      if (liveForms.length > 0) setForms(liveForms);
      if (liveConversations.length > 0) setConversations(liveConversations);
      if (storedMatrix) setPermissionMatrixState(storedMatrix);

      /*
       * =====================================================================
       * EVERYTHING ALREADY IN THIS BROWSER IS HISTORICAL UNTIL SOMEBODY SAYS SO
       * =====================================================================
       *
       * Recorded BEFORE the account is contacted, and before `ready` flips, so
       * the sync effect below cannot queue a single one of them. This is the
       * line that makes "Ask Sunny does not upload your old conversations
       * because you opened a page" a property of the code rather than a
       * promise: automatic sync only ever sees conversations whose signature
       * changed after hydration, and every pre-existing one is primed here.
       *
       * `liveConversations` rather than the raw read, so a seeded thread an
       * earlier build left in this browser is not even in the set — the purge
       * above has already taken it out.
       */
      for (const conversation of liveConversations) {
        historicalIds.current.add(conversation.id);
        syncedSignatures.current.set(conversation.id, signatureOf(conversation));
      }

      setStorageAvailable(true);
      setReady(true);

      /*
       * =====================================================================
       * THE ACCOUNT'S OWN HISTORY, MERGED IN — AND NEVER SUBTRACTED BY AN OUTAGE
       * =====================================================================
       *
       * `mergeConversations` is a union, and a failed read does not reach it at
       * all. That ordering is load-bearing: the persist effect below calls
       * `storage.replace()`, which deletes the whole IndexedDB collection and
       * writes back what it is given, so a merge that returned fewer
       * conversations than the browser holds would not merely display less — it
       * would destroy the local copy this phase depends on for rollback.
       */
      if (DEMO_MODE) return;

      try {
        const [serverConversations, state] = await Promise.all([
          fetchOwnConversations(),
          fetchHistoryState(),
        ]);
        if (cancelled) return;

        /*
         * A conversation the account already holds is not historical: it is
         * already server-backed, so continuing it should sync like any other.
         */
        for (const stored of state.stored) historicalIds.current.delete(stored.id);

        /*
         * PRIMED BEFORE THE STATE WRITE, NOT INSIDE IT. React invokes an updater
         * more than once in development, and this file's own rule is that
         * updaters stay pure — so the signatures for what the account already
         * holds are recorded here, where the values are known and the work
         * happens exactly once.
         *
         * A conversation the merge CHANGES — local turns unioned with account
         * turns — ends up with a different signature and is therefore queued,
         * which is correct: the union is news to the account.
         */
        for (const conversation of serverConversations) {
          syncedSignatures.current.set(conversation.id, signatureOf(conversation));
        }

        setHistoryState(state);
        setConversations((current) => {
          /*
           * ==============================================================
           * THE UNION, THEN THE DELETIONS — IN THAT ORDER
           * ==============================================================
           *
           * The merge is a union so an outage can never shrink local history.
           * That is exactly what would let a deliberate delete come back: this
           * browser's stale copy of a conversation deleted on another device
           * looks identical to history the account never saw.
           *
           * So the account's POSITIVE record of the deletion — a tombstone, or
           * a Clear History boundary — is applied after the union. A person's
           * delete wins over a browser that was not open when they made it.
           *
           * This removes the conversation from this browser too, because the
           * persist effect writes state back to IndexedDB. That is the intended
           * difference between keeping a local copy for OUR rollback and
           * keeping one against somebody's own decision to delete.
           */
          return suppressDeleted(
            mergeConversations(current, serverConversations),
            state,
          );
        });
      } catch {
        /*
         * Reported by the chat surface as a sync state rather than swallowed
         * into a wrong-looking History. Nothing local is touched, and nothing
         * is suppressed — an outage must not be able to imitate a delete.
         */
        if (!cancelled) setHistoryState(null);
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

  /*
   * TEMPLATES AND FORMS ARE DEMO CONTENT AND ARE STORED ONLY IN DEMO MODE.
   *
   * The live system of record for both is Supabase, read through
   * `/api/forms/templates` and `/api/forms/instances`. Writing them here in
   * live mode copied seeded records onto a real manager's disk, where the
   * hydrate path read them straight back as though they were theirs.
   */
  useEffect(() => {
    if (!ready) return;
    if (!DEMO_MODE) return;
    void storage.replace("form_templates", templates);
  }, [ready, storage, templates]);

  useEffect(() => {
    if (!ready) return;
    if (!DEMO_MODE) return;
    void storage.replace("generated_forms", forms);
  }, [ready, storage, forms]);

  /*
   * CONVERSATIONS ARE THE EXCEPTION, AND STAY PERSISTED IN LIVE MODE.
   *
   * They are now kept on the account as well — but the local copy is still
   * written, and that is deliberate rather than leftover. It is the rollback
   * protection for this phase: if server-backed history has to be turned off,
   * this browser still holds everything it ever held. It is also what the
   * person is reading when the network is gone.
   *
   * What must not be written is the SEEDED pair, and that is handled where it
   * belongs — they are no longer in state to be written, and `purgeDemoRecords`
   * removes the copies earlier builds left behind.
   *
   * THE ONE THING THIS DOES REMOVE is a conversation the person DELETED on
   * another device. Hydration drops it from state before this runs, so the
   * write takes it out of IndexedDB too — which is the difference between
   * keeping a local copy for our own rollback and keeping one against somebody
   * else's decision about their own content.
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
      /*
       * AND NEVER ONE THE PERSON DELETED. Suppressed conversations are removed
       * from state on hydration, so this is belt and braces for the window
       * between a delete landing on another device and this browser hearing
       * about it — during which a local edit must not push it back up. The
       * server refuses such a write too.
       */
      if (isSuppressed(conversation, historyState)) continue;

      const signature = signatureOf(conversation);
      if (syncedSignatures.current.get(conversation.id) === signature) continue;

      syncedSignatures.current.set(conversation.id, signature);
      sync.queue(conversation);
    }
  }, [ready, conversations, historyState, sync]);

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
      /*
       * RECORDED AS DELETED HERE TOO, so the rest of this session behaves the
       * way the next hydration will: it is not offered for import and it cannot
       * be re-synced. The account is the authority — this only stops the
       * browser contradicting a decision it just made itself.
       */
      setHistoryState((current) =>
        current === null
          ? current
          : {
              stored: current.stored.filter((stored) => stored.id !== id),
              deleted: current.deleted.includes(id)
                ? current.deleted
                : [...current.deleted, id],
              clearedAt: current.clearedAt,
            },
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
    /*
     * THE BOUNDARY, LOCALLY, FOR THE REST OF THIS SESSION. The server wrote the
     * authoritative one from its own clock; this keeps the browser consistent
     * with it until the next hydration reads it back, so nothing cleared can be
     * offered for import or re-synced in the meantime.
     *
     * In demo mode there is no server, and a local boundary would be a promise
     * the deployment cannot keep — so it stays null and only the visible list
     * is emptied, exactly as before.
     */
    if (!DEMO_MODE) {
      setHistoryState({
        stored: [],
        deleted: [],
        clearedAt: new Date().toISOString(),
      });
    }
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
    if (DEMO_MODE) return [];
    return eligibleForImport(conversations, historyState);
  }, [conversations, historyState]);

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
      setHistoryState((current) =>
        current === null
          ? current
          : {
              ...current,
              stored: [
                ...current.stored.filter(
                  (stored) => !summary.imported.includes(stored.id),
                ),
                ...summary.imported.map((id) => ({
                  id,
                  messages:
                    candidates.find((entry) => entry.id === id)?.messages.length ?? 0,
                })),
              ],
            },
      );
    }

    return summary;
  }, [importableConversations]);


  const setPermissionMatrix = useCallback((matrix: PermissionMatrix) => {
    setPermissionMatrixState(matrix);
  }, []);

  /**
   * Restore the seeded set. A deliberate wipe somebody clicks, never automatic.
   *
   * THE SEEDS ARE IMPORTED HERE, NOT AT MODULE SCOPE, for the reason the
   * hydrate effect gives: a static import would put every seeded record back
   * into the production bundle to serve a control only demo mode offers.
   *
   * IT REFUSES OUTSIDE DEMO MODE. There is nothing to restore on a live
   * deployment — the seeds are not this deployment's data — and clearing real
   * local state to write fabricated records over it would be the worst
   * possible reading of "reset".
   */
  const resetDemoData = useCallback(async () => {
    if (!DEMO_MODE) return;
    const demo = await demoRuntime.loadSeeds();
    await storage.clearAll();
    setDocuments([...demo.documents]);
    setVideos([...demo.videos]);
    setTemplates([...demo.templates]);
    setForms([...demo.forms]);
    setConversations([...demo.conversations]);
    setPermissionMatrixState(DEFAULT_PERMISSION_MATRIX);
    /*
     * NOTHING TO GUARD AGAINST HERE ANY MORE, and it is worth saying why.
     * This returns early unless the build is the demo one, the chat sync effect
     * is disabled in demo mode, and a seeded id is refused by the structural
     * validator in any case. Three independent reasons a restored seed cannot
     * reach Supabase — the right number for something that cannot be undone by
     * apologising for it.
     */
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

/**
 * The store, or null when there is no provider above this component.
 *
 * For the handful of presentational components that are rendered both inside
 * the app and on their own — a message bubble in a test, an answer sheet in
 * isolation. They read the store for a convenience (resolving a recommended
 * video id) and must degrade to "nothing found" rather than throw: a missing
 * video card is a smaller failure than a crashed conversation.
 *
 * `useAppStore` keeps throwing, and should: anything that needs the store to
 * function is better off failing loudly than rendering half a screen.
 */
export function useOptionalAppStore(): AppStoreValue | null {
  return useContext(AppStoreContext);
}

export function useAppStore(): AppStoreValue {
  const context = useContext(AppStoreContext);
  if (!context) {
    throw new Error("useAppStore must be used inside AppStoreProvider");
  }
  return context;
}
