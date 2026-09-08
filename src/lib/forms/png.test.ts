import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { PngError, decodePng } from "./png";

/**
 * THE PNG DECODER, CHECKED AGAINST PNGs THIS FILE BUILDS ITSELF.
 *
 * Every fixture is encoded here from known pixels, so a passing assertion means
 * the decoder reproduced a value the test already knew — not that two pieces of
 * the same code agreed with each other. The five scanline filters get one case
 * each, because filter 4 (Paeth) is the one that is easy to write subtly wrong
 * and impossible to notice on a small image.
 */

/* ------------------------------------------------------------ encoding --- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc(typed));
  return Buffer.concat([length, typed, check]);
}

interface PngOptions {
  width: number;
  height: number;
  colourType: number;
  depth?: number;
  interlace?: number;
  /** One filter type per row; the raw (unfiltered) samples for each row. */
  rows: { filter: number; samples: number[] }[];
  palette?: number[];
  transparency?: number[];
}

/**
 * Builds a PNG whose scanlines are stored under a chosen filter.
 *
 * The filter is APPLIED here rather than assumed, so a fixture claiming filter 4
 * really does hold Paeth-encoded bytes and the decoder has to undo them.
 */
function makePng(options: PngOptions): Uint8Array {
  const { width, height, colourType, depth = 8, interlace = 0, rows } = options;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType] ?? 1;
  const stride = width * channels;

  const raw: number[] = [];
  let prior = new Array<number>(stride).fill(0);

  for (const row of rows) {
    raw.push(row.filter);
    const encoded = new Array<number>(stride).fill(0);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? row.samples[i - channels] : 0;
      const up = prior[i];
      const upLeft = i >= channels ? prior[i - channels] : 0;
      let predictor = 0;
      switch (row.filter) {
        case 1:
          predictor = left;
          break;
        case 2:
          predictor = up;
          break;
        case 3:
          predictor = (left + up) >> 1;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          break;
        }
      }
      encoded[i] = (row.samples[i] - predictor) & 0xff;
    }
    raw.push(...encoded);
    prior = row.samples;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colourType;
  ihdr[12] = interlace;

  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
  ];
  if (options.palette) parts.push(chunk("PLTE", Buffer.from(options.palette)));
  if (options.transparency) parts.push(chunk("tRNS", Buffer.from(options.transparency)));
  parts.push(chunk("IDAT", deflateSync(Buffer.from(raw))));
  parts.push(chunk("IEND", Buffer.alloc(0)));

  return Uint8Array.from(Buffer.concat(parts));
}

/** The RGB triple at one pixel of a decoded image. */
const pixel = (image: { width: number; rgb: Uint8Array }, x: number, y: number) => {
  const at = (y * image.width + x) * 3;
  return [image.rgb[at], image.rgb[at + 1], image.rgb[at + 2]];
};

/* --------------------------------------------------------------- tests --- */

describe("decoding a PNG into PDF samples", () => {
  it("reads truecolour pixels back exactly", () => {
    const png = makePng({
      width: 2,
      height: 1,
      colourType: 2,
      rows: [{ filter: 0, samples: [255, 0, 0, 0, 0, 255] }],
    });
    const image = decodePng(png);

    expect(image.width).toBe(2);
    expect(image.height).toBe(1);
    expect(pixel(image, 0, 0)).toEqual([255, 0, 0]);
    expect(pixel(image, 1, 0)).toEqual([0, 0, 255]);
  });

  it.each([
    ["none", 0],
    ["sub", 1],
    ["up", 2],
    ["average", 3],
    ["paeth", 4],
  ])("undoes the %s scanline filter", (_name, filter) => {
    /*
     * Two rows, so filters that look UPWARD have something to look at. A decoder
     * that ignored the filter byte would pass the "none" case and fail these,
     * which is exactly what makes them worth running.
     */
    const first = [10, 20, 30, 40, 50, 60];
    const second = [200, 150, 100, 90, 80, 70];
    const png = makePng({
      width: 2,
      height: 2,
      colourType: 2,
      rows: [
        { filter, samples: first },
        { filter, samples: second },
      ],
    });
    const image = decodePng(png);

    expect(pixel(image, 0, 0)).toEqual([10, 20, 30]);
    expect(pixel(image, 1, 0)).toEqual([40, 50, 60]);
    expect(pixel(image, 0, 1)).toEqual([200, 150, 100]);
    expect(pixel(image, 1, 1)).toEqual([90, 80, 70]);
  });

  it("flattens alpha onto white, because that is the paper", () => {
    const png = makePng({
      width: 3,
      height: 1,
      colourType: 6,
      rows: [
        {
          filter: 0,
          // Opaque black, half-transparent black, fully transparent black.
          samples: [0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 0],
        },
      ],
    });
    const image = decodePng(png);

    expect(pixel(image, 0, 0)).toEqual([0, 0, 0]);
    // 0 over white at ~50% is mid grey, and definitely not black or white.
    expect(pixel(image, 1, 0)[0]).toBeGreaterThan(110);
    expect(pixel(image, 1, 0)[0]).toBeLessThan(145);
    expect(pixel(image, 2, 0)).toEqual([255, 255, 255]);
  });

  it("reads greyscale, greyscale+alpha and palette images", () => {
    const grey = decodePng(
      makePng({ width: 2, height: 1, colourType: 0, rows: [{ filter: 0, samples: [0, 255] }] }),
    );
    expect(pixel(grey, 0, 0)).toEqual([0, 0, 0]);
    expect(pixel(grey, 1, 0)).toEqual([255, 255, 255]);

    const greyAlpha = decodePng(
      makePng({ width: 2, height: 1, colourType: 4, rows: [{ filter: 0, samples: [0, 255, 0, 0] }] }),
    );
    expect(pixel(greyAlpha, 0, 0)).toEqual([0, 0, 0]);
    expect(pixel(greyAlpha, 1, 0)).toEqual([255, 255, 255]);

    const paletted = decodePng(
      makePng({
        width: 2,
        height: 1,
        colourType: 3,
        palette: [12, 34, 56, 200, 100, 50],
        rows: [{ filter: 0, samples: [0, 1] }],
      }),
    );
    expect(pixel(paletted, 0, 0)).toEqual([12, 34, 56]);
    expect(pixel(paletted, 1, 0)).toEqual([200, 100, 50]);
  });

  it("honours palette transparency", () => {
    const image = decodePng(
      makePng({
        width: 1,
        height: 1,
        colourType: 3,
        palette: [0, 0, 0],
        transparency: [0],
        rows: [{ filter: 0, samples: [0] }],
      }),
    );
    expect(pixel(image, 0, 0)).toEqual([255, 255, 255]);
  });

  /*
   * THE REFUSALS. Each one is a file the decoder could plausibly half-read and
   * turn into noise. A logo that prints as static is worse than a download that
   * fails a test, so these are errors by name rather than best-effort output.
   */
  it("refuses what it cannot decode, by name", () => {
    expect(() => decodePng(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(PngError);

    expect(() =>
      decodePng(
        makePng({
          width: 1,
          height: 1,
          colourType: 2,
          depth: 16,
          rows: [{ filter: 0, samples: [0, 0, 0] }],
        }),
      ),
    ).toThrow(/16-bit/);

    expect(() =>
      decodePng(
        makePng({
          width: 1,
          height: 1,
          colourType: 2,
          interlace: 1,
          rows: [{ filter: 0, samples: [0, 0, 0] }],
        }),
      ),
    ).toThrow(/Interlaced/);
  });

  it("refuses a truncated image rather than padding it", () => {
    const png = makePng({
      width: 4,
      height: 4,
      colourType: 2,
      rows: [{ filter: 0, samples: new Array(12).fill(7) }],
    });
    // The header claims four rows; only one was encoded.
    expect(() => decodePng(png)).toThrow(/short/);
  });
});
