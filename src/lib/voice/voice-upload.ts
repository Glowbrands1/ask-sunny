import "server-only";

/**
 * ============================================================================
 * READING THE VOICE UPLOAD AS A STREAM (VOICE_INPUT_ENABLED)
 * ============================================================================
 *
 * The browser sends `multipart/form-data` with its small text fields first and the `audio` part last. The route
 * reads it in two steps, so nobody's audio is read before their access is checked:
 *
 *   1. `openVoiceUpload` reads only as far as the start of the `audio` part (at most FIELD_HEAD_LIMIT bytes) and
 *      returns the text fields before it.
 *   2. `readAudio` reads the rest, and stops reading the moment the body passes the byte limit, whatever
 *      Content-Length said. The audio stays in memory only for this request; it is never written anywhere.
 *
 * Strict: a field that is a file, a field given twice, an `audio` part that is not a file, or any part after
 * `audio` is a bad request.
 */

export const FIELD_HEAD_LIMIT = 16 * 1024;
/** Room for the multipart boundaries and part headers around the audio. */
const ENVELOPE_BYTES = 2 * 1024;

export class VoiceUploadError extends Error {
  constructor(
    readonly code: "bad_request" | "too_large",
    message: string,
  ) {
    super(message);
    this.name = "VoiceUploadError";
  }
}

interface Part {
  readonly name: string;
  readonly filename: string | null;
  readonly contentType: string | null;
  /** Null until the part's end has been read. */
  readonly body: Buffer | null;
}

interface Parsed {
  readonly parts: Part[];
  readonly ended: boolean;
}

const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");

function boundaryOf(contentType: string | null): string | null {
  if (!contentType || !/^multipart\/form-data\s*;/i.test(contentType)) return null;
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2] ?? null;
  return boundary && boundary.length <= 200 ? boundary : null;
}

function headerParams(headerBlock: string): { name: string | null; filename: string | null; contentType: string | null } {
  let name: string | null = null;
  let filename: string | null = null;
  let contentType: string | null = null;
  for (const line of headerBlock.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "content-disposition") {
      if (!/^form-data\b/i.test(value)) continue;
      name = /\bname="([^"]*)"/i.exec(value)?.[1] ?? null;
      filename = /\bfilename="([^"]*)"/i.exec(value)?.[1] ?? null;
    } else if (key === "content-type") {
      contentType = value;
    }
  }
  return { name, filename, contentType };
}

/** Parses as much of the body as has arrived. Throws a bad request on anything that is not well-formed. */
function parse(buffer: Buffer, boundary: string): Parsed {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Part[] = [];
  const first = buffer.indexOf(delimiter);
  if (first < 0) {
    if (buffer.length > delimiter.length + 2) throw new VoiceUploadError("bad_request", "not multipart");
    return { parts, ended: false };
  }
  let pos = first + delimiter.length;
  for (;;) {
    if (buffer.length < pos + 2) return { parts, ended: false };
    if (buffer[pos] === 0x2d && buffer[pos + 1] === 0x2d) return { parts, ended: true };
    if (!buffer.subarray(pos, pos + 2).equals(CRLF)) throw new VoiceUploadError("bad_request", "bad boundary");
    pos += 2;
    const headerEnd = buffer.indexOf(HEADER_END, pos);
    if (headerEnd < 0) {
      if (buffer.length - pos > 4096) throw new VoiceUploadError("bad_request", "part headers too long");
      return { parts, ended: false };
    }
    const { name, filename, contentType } = headerParams(buffer.subarray(pos, headerEnd).toString("utf8"));
    if (name === null) throw new VoiceUploadError("bad_request", "part without a name");
    const bodyStart = headerEnd + HEADER_END.length;
    const next = buffer.indexOf(Buffer.concat([CRLF, delimiter]), bodyStart);
    if (next < 0) {
      parts.push({ name, filename, contentType, body: null });
      return { parts, ended: false };
    }
    parts.push({ name, filename, contentType, body: buffer.subarray(bodyStart, next) });
    pos = next + CRLF.length + delimiter.length;
  }
}

export interface VoiceUpload {
  /** The text fields that came before `audio`, by name. */
  readonly fields: Readonly<Record<string, string>>;
  /** Reads the audio part, stopping once the body passes `maxBytes` of audio. */
  readAudio(maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string | null }>;
  /** Stops reading (the request was refused before the audio was needed). */
  cancel(): Promise<void>;
}

function textFields(parts: readonly Part[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of parts) {
    if (part.name === "audio") break;
    if (part.filename !== null) throw new VoiceUploadError("bad_request", "unexpected file");
    if (part.body === null) throw new VoiceUploadError("bad_request", "incomplete field");
    if (Object.prototype.hasOwnProperty.call(fields, part.name)) throw new VoiceUploadError("bad_request", "repeated field");
    fields[part.name] = part.body.toString("utf8");
  }
  return fields;
}

export async function openVoiceUpload(request: Request): Promise<VoiceUpload> {
  const boundary = boundaryOf(request.headers.get("content-type"));
  if (!boundary || !request.body) throw new VoiceUploadError("bad_request", "not multipart");
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let done = false;

  const pull = async (): Promise<boolean> => {
    if (done) return false;
    const next = await reader.read();
    if (next.done) {
      done = true;
      return false;
    }
    const chunk = Buffer.from(next.value);
    chunks.push(chunk);
    total += chunk.length;
    return true;
  };
  const cancel = async () => {
    done = true;
    await reader.cancel().catch(() => undefined);
  };

  /* Step 1: as far as the audio part's headers. */
  let parsed: Parsed = { parts: [], ended: false };
  for (;;) {
    parsed = parse(Buffer.concat(chunks, total), boundary);
    const audioSeen = parsed.parts.some((part) => part.name === "audio");
    if (audioSeen || parsed.ended) break;
    if (total > FIELD_HEAD_LIMIT) {
      await cancel();
      throw new VoiceUploadError("bad_request", "fields too long");
    }
    if (!(await pull())) {
      parsed = parse(Buffer.concat(chunks, total), boundary);
      break;
    }
  }
  let fields: Record<string, string>;
  try {
    fields = textFields(parsed.parts);
  } catch (error) {
    await cancel();
    throw error;
  }

  return {
    fields,
    cancel,
    async readAudio(maxBytes: number) {
      const limit = FIELD_HEAD_LIMIT + maxBytes + ENVELOPE_BYTES;
      while (await pull()) {
        if (total > limit) {
          await cancel();
          throw new VoiceUploadError("too_large", "upload too large");
        }
      }
      const all = parse(Buffer.concat(chunks, total), boundary);
      if (!all.ended) throw new VoiceUploadError("bad_request", "incomplete body");
      const index = all.parts.findIndex((part) => part.name === "audio");
      if (index < 0) throw new VoiceUploadError("bad_request", "no audio");
      if (index !== all.parts.length - 1) throw new VoiceUploadError("bad_request", "field after audio");
      const audio = all.parts[index]!;
      if (audio.filename === null || audio.body === null) throw new VoiceUploadError("bad_request", "audio is not a file");
      if (audio.body.length > maxBytes) throw new VoiceUploadError("too_large", "audio too large");
      chunks.length = 0;
      return { bytes: new Uint8Array(audio.body), contentType: audio.contentType };
    },
  };
}

/** The container the first bytes say it is: WebM `1A 45 DF A3`, MP4 `ftyp` at offset 4, Ogg `OggS`, WAV `RIFF`. */
export function sniffAudio(bytes: Uint8Array): "audio/webm" | "audio/mp4" | "audio/ogg" | "audio/wav" | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "audio/mp4";
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return "audio/ogg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "audio/wav";
  return null;
}

/** The declared type, without its parameters, when it is one the route takes. */
export function declaredAudioType(contentType: string | null): "audio/webm" | "audio/mp4" | "audio/ogg" | "audio/wav" | null {
  const base = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (base === "audio/webm" || base === "video/webm") return "audio/webm";
  if (base === "audio/mp4" || base === "audio/x-m4a" || base === "audio/m4a" || base === "video/mp4") return "audio/mp4";
  if (base === "audio/ogg") return "audio/ogg";
  if (base === "audio/wav" || base === "audio/x-wav" || base === "audio/wave") return "audio/wav";
  return null;
}
