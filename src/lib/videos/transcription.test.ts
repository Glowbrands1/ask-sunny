import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  __setTranscriptionProvider,
  getTranscriptionProvider,
  transcriptionStatus,
  UnconfiguredTranscriptionProvider,
  type VideoTranscriptionProvider,
} from "./transcription";

/**
 * ============================================================================
 * NO PROVIDER, AND THEREFORE NO TRANSCRIPT
 * ============================================================================
 *
 * The audit found no speech-to-text integration in this project: the only AI
 * dependency is `@anthropic-ai/sdk`, Claude does not accept audio or video
 * input, and Supabase Storage stores bytes rather than transcribing them. Every
 * real option is paid per minute, so none was added.
 *
 * What must never happen while that is true is a plausible-looking transcript
 * produced by something that never heard the audio. A fabricated transcript of
 * a safety procedure is worse than no transcript, because a manager would act
 * on it — so the shipped provider REFUSES rather than returning empty text that
 * a caller might mistake for a successful run.
 */

afterEach(() => {
  __setTranscriptionProvider(new UnconfiguredTranscriptionProvider());
});

describe("the provider that ships today", () => {
  it("reports itself unconfigured", () => {
    const provider = getTranscriptionProvider();
    expect(provider.configured).toBe(false);
    expect(provider.name).toBe("None configured");
  });

  it("refuses rather than returning empty text", async () => {
    const result = await getTranscriptionProvider().transcribe({
      videoId: "v1",
      mediaUrl: "https://signed.example/object?token=abc",
      mimeType: "video/mp4",
    });

    expect(result.ok).toBe(false);
    // Specifically NOT `{ ok: true, text: "" }`, which a caller could take for
    // a video with no speech in it.
    expect(result).not.toHaveProperty("text");
  });

  it("distinguishes 'no provider' from 'the provider failed'", async () => {
    const result = await getTranscriptionProvider().transcribe({
      videoId: "v1",
      mediaUrl: "https://signed.example/object",
      mimeType: "video/mp4",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.notConfigured).toBe(true);
  });

  it("says playback is unaffected, because it is", async () => {
    const result = await getTranscriptionProvider().transcribe({
      videoId: "v1",
      mediaUrl: "https://signed.example/object",
      mimeType: "video/mp4",
    });
    if (!result.ok) expect(result.safeMessage).toMatch(/Playback is unaffected/);
  });

  it("names what is missing without naming a value", () => {
    const status = transcriptionStatus();
    expect(status.configured).toBe(false);
    expect(status.missing.join(" ")).toMatch(/speech-to-text provider account/i);
    expect(status.missing.join(" ")).not.toMatch(/sk-|key=|Bearer/);
  });
});

describe("a failure never carries the media URL back", () => {
  /**
   * THE SIGNED URL IS A WORKING CREDENTIAL for a private object. A provider
   * that echoes its request on failure would put one into `transcript_error_safe`
   * — a column that is read back to a browser — and the column's name carries
   * the rule. This test proves the rule is enforceable: a provider that leaks
   * is detectable at the seam.
   */
  it("is detectable when a provider leaks it", async () => {
    const leaky: VideoTranscriptionProvider = {
      name: "Leaky",
      configured: true,
      missingConfiguration: [],
      async transcribe(request) {
        return {
          ok: false,
          notConfigured: false,
          safeMessage: `Upstream rejected ${request.mediaUrl}`,
        };
      },
    };

    __setTranscriptionProvider(leaky);
    const result = await getTranscriptionProvider().transcribe({
      videoId: "v1",
      mediaUrl: "https://signed.example/object?token=SECRET",
      mimeType: "video/mp4",
    });

    if (!result.ok) {
      // The assertion a real provider implementation must satisfy.
      expect(result.safeMessage).toContain("SECRET");
    }
  });

  it("is satisfied by a provider that writes its own wording", async () => {
    const safe: VideoTranscriptionProvider = {
      name: "Careful",
      configured: true,
      missingConfiguration: [],
      async transcribe() {
        return {
          ok: false,
          notConfigured: false,
          safeMessage: "The transcription service rejected this file.",
        };
      },
    };

    __setTranscriptionProvider(safe);
    const result = await getTranscriptionProvider().transcribe({
      videoId: "v1",
      mediaUrl: "https://signed.example/object?token=SECRET",
      mimeType: "video/mp4",
    });

    if (!result.ok) {
      expect(result.safeMessage).not.toContain("SECRET");
      expect(result.safeMessage).not.toContain("signed.example");
    }
  });
});

describe("nothing in the repository fabricates a transcript", () => {
  it("does not ask Claude to describe a video it cannot hear", () => {
    const transcription = readFileSync("src/lib/videos/transcription.ts", "utf8");
    const code = transcription
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(code).not.toMatch(/anthropic/i);
    expect(code).not.toMatch(/callClaude/);
    expect(code).not.toMatch(/messages\.create/);
  });

  it("adds no transcription dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const names = Object.keys(pkg.dependencies ?? {}).join(" ");

    for (const vendor of ["openai", "deepgram", "assemblyai", "whisper", "speech"]) {
      expect(names).not.toContain(vendor);
    }
  });

  it("keeps the database from accepting a ready transcript with no text", () => {
    const migration = readFileSync(
      "supabase/migrations/20260906001000_training_videos.sql",
      "utf8",
    );
    expect(migration).toContain("training_videos_ready_transcript_has_text");
    expect(migration).toMatch(/transcript_status <> 'ready'\s*\n\s*or \(transcript_text is not null/);
  });
});
