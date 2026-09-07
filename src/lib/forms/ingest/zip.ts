import { inflateRawSync } from "node:zlib";

/**
 * READING ONE NAMED ENTRY OUT OF A ZIP.
 *
 * A `.docx` is a zip, and the two things this pipeline needs that a Word-to-HTML
 * converter does not report both live in entries of their own:
 *
 *   `word/header1.xml`  the page header — where the Coaching Form keeps its
 *                       TITLE and the Sun Tan City brand. A reader that only
 *                       saw the body would produce a form with no name on it.
 *   `word/document.xml` the body as Word actually stored it, which still has
 *                       content controls and legacy form fields in it after a
 *                       converter has flattened them away.
 *
 * WHY NOT A ZIP LIBRARY. There is no zip dependency in this project, and adding
 * one to read two files would be a supply-chain decision taken for a
 * convenience. The format's directory is 46 bytes plus a name per entry and its
 * only compression here is raw DEFLATE, which Node already has.
 *
 * IT IS A READER, NOT AN EXTRACTOR. Nothing is written to disk and no path from
 * the archive is ever used as a path — an entry is found by exact name and
 * returned as text. Zip-slip has nothing to work with.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** The end-of-central-directory record, which is at the end minus a comment. */
function findEndOfCentralDirectory(view: DataView): number | null {
  const start = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return null;
}

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 raw DEFLATE. Anything else is refused rather than guessed at. */
  method: number;
  offset: number;
  compressedSize: number;
  uncompressedSize: number;
}

/** Every entry the archive declares, or null when it is not a readable zip. */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] | null {
  if (bytes.byteLength < 22) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(view);
  if (end === null) return null;

  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder("utf-8");

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.byteLength) return null;
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) return null;
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    entries.push({ name, method, offset, compressedSize, uncompressedSize });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * One entry's bytes as UTF-8 text, or null.
 *
 * Null rather than a throw for every "not here, not readable, not a shape we
 * support" case: a header this cannot read is a title the form does without,
 * not a failed upload.
 */
export function readZipText(bytes: Uint8Array, name: string): string | null {
  const entries = listZipEntries(bytes);
  const entry = entries?.find((candidate) => candidate.name === name);
  if (!entry) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.offset + 30 > bytes.byteLength) return null;
  if (view.getUint32(entry.offset, true) !== LOCAL_SIGNATURE) return null;

  // The LOCAL header's name and extra lengths are authoritative for where the
  // data starts; the central directory's may differ.
  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const data = bytes.subarray(start, start + entry.compressedSize);

  try {
    if (entry.method === 0) return new TextDecoder("utf-8").decode(data);
    if (entry.method === 8) return new TextDecoder("utf-8").decode(inflateRawSync(data));
  } catch {
    return null;
  }
  return null;
}

/** Whether the archive holds a Word body — the .docx test, on the entry names. */
export function isWordArchive(bytes: Uint8Array): boolean {
  const entries = listZipEntries(bytes);
  return entries?.some((entry) => entry.name === "word/document.xml") ?? false;
}
