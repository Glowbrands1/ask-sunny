// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AskResponse, ClientAskRequest } from "@/lib/ai/types";

/*
 * DEMO MODE, SET BEFORE THE STORE MODULE LOADS.
 *
 * These cases are about the chat rail's behaviour over EXISTING conversations,
 * and the seeded pair is their fixture. `app-store.tsx` reads the mode once at
 * module scope, so this has to run before the imports above resolve — which is
 * what `vi.hoisted` is for. Setting it in `beforeAll` would be too late.
 *
 * It became necessary when demo mode stopped being the default for an unset
 * flag: the store now starts empty in live mode, which is the correct
 * production behaviour and leaves these tests with nothing to click.
 */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_DEMO_MODE = "true";
});


/**
 * =============================================================================
 * THE FORMS FLOW, DRIVEN THROUGH THE REAL SCREEN
 * =============================================================================
 *
 * REPORTED FROM THE DEMO, and all three symptoms are one defect:
 *
 *   "When in the middle of a chat I say I need a form — it asks which form and
 *    provides bubbles to choose from with all form types. These have no action
 *    tied to them when clicked — and it 'ends' the chat. I'm unable to chat
 *    back and specify 'coaching form'."
 *
 *   "The 'create a form from this conversation' link does not work."
 *
 * Nothing was broken about the cards, the link or the composer. Every one of
 * them sends an ordinary turn through `ChatScreen.send`, and `send` returned
 * early while the last answer was unrated — which, after "Which form do you
 * need?", it always is. The conversation had not ended; it had been stopped by
 * a review it never said it was waiting for.
 *
 * SO THIS TEST DRIVES THE WHOLE SCREEN rather than a component: the real
 * composer, the real form picker, the real rail action, the real store. The
 * provider is the only stand-in, because the browser is where the defect was.
 */

/** jsdom lacks the layout and pointer APIs Radix's primitives reach for. */
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  for (const name of [
    "hasPointerCapture",
    "setPointerCapture",
    "releasePointerCapture",
  ] as const) {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, {
        value: () => false,
        writable: true,
      });
    }
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

/**
 * THE PROVIDER, STANDING IN FOR THE SERVER AND NOTHING ELSE.
 *
 * It answers the way `/api/chat` answers a request that names no form: the
 * selector's choices, and a `turnId`, because a turn WITH an id is precisely
 * the state that used to stop everything. Demo mode's own provider refuses to
 * propose forms — correctly, it can see neither the published library nor a
 * verified scope — so it cannot exercise this path.
 */
const asked: ClientAskRequest[] = [];

const SELECTION = {
  primary: {
    templateKey: "coaching",
    templateName: "Coaching Form",
    description: "The everyday documented coaching conversation.",
  },
  additional: [
    {
      templateKey: "dpoa",
      templateName: "Corrective Action Form",
      description: "The formal corrective step after coaching.",
    },
    {
      templateKey: "policy-review",
      templateName: "Policy Review",
      description: "A documented review of a policy with an employee.",
    },
  ],
};

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return {
    ...actual,
    aiProviderStatus: () => ({
      name: "Claude (Anthropic)",
      connected: true,
      detail: "Answering live.",
    }),
    getAIProvider: () => ({
      name: "stub",
      connected: true,
      titleForConversation: (first: string) => first.slice(0, 40),
      async ask(request: ClientAskRequest): Promise<AskResponse> {
        asked.push(request);
        /* Every answer carries a turn id: the rateable state, which is the one
           that used to stop the conversation. */
        const turnId = `turn-${asked.length}`;
        if (/coaching form/i.test(request.question)) {
          return {
            content: "I can draft a Coaching Form. Who is it about?",
            citations: [],
            coverage: "not_applicable",
            recommendedVideoIds: [],
            turnId,
          };
        }
        return {
          content: "Which form do you need?",
          citations: [],
          coverage: "not_applicable",
          recommendedVideoIds: [],
          formSelection: SELECTION,
          turnId,
        };
      },
    }),
  };
});

const { Providers } = await import("@/app/providers");
const { ChatScreen } = await import("./chat-screen");

beforeEach(() => {
  asked.length = 0;
});

afterEach(() => {
  cleanup();
});

async function ask(text: string) {
  const user = userEvent.setup();
  const field = screen.getByLabelText(/ask sunny a question/i);
  await user.type(field, text);
  await user.click(screen.getByRole("button", { name: /send message/i }));
}

function renderChat() {
  return render(
    <Providers>
      <ChatScreen />
    </Providers>,
  );
}

/* --------------------------------------------------------- the whole flow -- */

describe('"I need a form" reaches the form, with no rating anywhere in the way', () => {
  it("answers with the choices and lets one be chosen", async () => {
    const user = userEvent.setup();
    renderChat();

    await ask("I need a form");
    await screen.findByText("Which form do you need?");

    /*
     * THE CARDS ARE THERE AND THEY ARE CONTROLS. This much was always true —
     * what follows is what was not.
     */
    const card = await screen.findByRole("button", { name: /Coaching Form/ });
    await user.click(card);

    /*
     * THE CLICK PRODUCED A TURN. Before, `send` returned early because the
     * "Which form do you need?" answer was unrated, so this was 1 forever and
     * the screen looked frozen.
     */
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1].question).toBe("Create a Coaching Form from this conversation.");

    await screen.findByText(/I can draft a Coaching Form/);
  });

  it("keeps taking typed questions after an unrated answer", async () => {
    renderChat();

    await ask("I need a form");
    await screen.findByText("Which form do you need?");

    /* The composer is not disabled and says nothing about rating. */
    const field = screen.getByLabelText(/ask sunny a question/i) as HTMLTextAreaElement;
    expect(field.disabled).toBe(false);
    expect(screen.queryByText(/please rate the answer above/i)).toBeNull();
    expect(screen.queryByText(/required before your next question/i)).toBeNull();

    await ask("Actually, the coaching form");
    await waitFor(() => expect(asked).toHaveLength(2));
  });

  it("sends 'Create a form from this conversation' straight away", async () => {
    const user = userEvent.setup();
    renderChat();

    await ask("One of my employees was late three times this month.");
    await screen.findByText("Which form do you need?");

    await user.click(
      screen.getByRole("button", { name: /create a form from this conversation/i }),
    );

    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1].question).toBe("Create a form from this conversation.");
  });
});

/* ----------------------------------------------------------- the rating ---- */

describe("rating is offered once, passively, and required by nothing", () => {
  it("shows no rating form until it is asked for", async () => {
    renderChat();
    await ask("What is the PTO policy?");
    await screen.findByText("Which form do you need?");

    /*
      The invitation is one line; the form behind it is not mounted. Named
      rather than counted, because the composer's own answer-mode control is
      also a radiogroup — Quick / Standard / Detailed — and always has been.
    */
    expect(
      screen.getByRole("button", { name: /rate this conversation/i }),
    ).toBeDefined();
    expect(
      screen.queryByRole("radiogroup", { name: /how was your ask sunny experience/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("radiogroup", { name: /what you needed/i }),
    ).toBeNull();
  });

  it("opens the review UI on request, and one control serves the whole thread", async () => {
    const user = userEvent.setup();
    renderChat();

    await ask("What is the PTO policy?");
    await screen.findByText("Which form do you need?");
    await ask("And for part-time staff?");
    await waitFor(() => expect(asked).toHaveLength(2));

    /*
     * TWO ANSWERS, ONE INVITATION. A panel per answer is what made the old
     * behaviour feel like being nagged.
     */
    const invitations = screen.getAllByRole("button", {
      name: /rate this conversation/i,
    });
    expect(invitations).toHaveLength(1);

    await user.click(invitations[0]);
    expect(screen.getByText(/how was your ask sunny experience\?/i)).toBeDefined();
    expect(
      screen.getByRole("radiogroup", { name: /how was your ask sunny experience/i }),
    ).toBeDefined();
  });

  it("marks the conversation rated and still lets the next question through", async () => {
    const user = userEvent.setup();
    renderChat();

    await ask("What is the PTO policy?");
    await screen.findByText("Which form do you need?");

    await user.click(screen.getByRole("button", { name: /rate this conversation/i }));
    await user.click(screen.getByRole("radio", { name: /^5 — Very helpful$/ }));
    await user.click(screen.getByRole("button", { name: /submit feedback/i }));

    /*
     * DEMO MODE SAVES LOCALLY — no `/api/chat/feedback` call — and the host
     * still writes it onto the message, which is what makes the conversation
     * read as rated rather than asking again.
     */
    await screen.findByText("Rated");
    expect(
      screen.queryByRole("button", { name: /rate this conversation/i }),
    ).toBeNull();

    await ask("And for part-time staff?");
    await waitFor(() => expect(asked).toHaveLength(2));
  });
});

/* ------------------------------------------------------------ the picker --- */

describe("the form picker offers the rest of the library without leaving the chat", () => {
  it("expands to the other forms, each one a control", async () => {
    const user = userEvent.setup();
    renderChat();

    await ask("I need a form");
    await screen.findByText("Which form do you need?");

    await user.click(screen.getByRole("button", { name: /see more forms/i }));

    const more = screen.getByRole("group", { name: /more forms/i });
    expect(within(more).getByRole("button", { name: /Corrective Action Form/ })).toBeDefined();

    await user.click(within(more).getByRole("button", { name: /Policy Review/ }));
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1].question).toBe("Create a Policy Review from this conversation.");
  });
});
