import { inflateSync } from "node:zlib";

/**
 * ============================================================================
 * A PNG, TURNED INTO SOMETHING A PDF CAN DRAW
 * ============================================================================
 *
 * PDF has no idea what a PNG is. It draws an image XObject: a raw sample
 * stream, a colour space, and a compression filter. A PNG's pixel data is
 * zlib-compressed like a PDF's FlateDecode stream, but each scanline is
 * PREFILTERED first — every row is stored as a difference against its
 * neighbours — so the bytes cannot simply be copied across. They have to be
 * inflated, un-filtered, and handed over as plain samples.
 *
 * WHY THIS IS HERE RATHER THAN A DEPENDENCY. The repository has no image
 * library, and the two candidates would have been added for one 317x284 logo on
 * the path that renders employees' disciplinary records. Inflation is
 * `node:zlib`, which ships with the runtime; what remains is the scanline
 * filter, which is five cases and is fully specified. That is a smaller and
 * more inspectable thing than a transitive dependency tree, and it matches the
 * choice the PDF renderer already made about not taking one.
 *
 * ALPHA IS COMPOSITED ONTO WHITE RATHER THAN CARRIED. A PDF expresses
 * transparency with a second image — an /SMask — which doubles the streams and
 * the failure modes. Every page this renderer produces is white paper, so
 * flattening onto white is pixel-identical to masking and needs neither. The
 * logo's rounded corners come out white, which is what they sit on.
 *
 * SUPPORTED: 8-bit greyscale, RGB, palette, greyscale+alpha and RGBA — every
 * colour type PNG defines at that depth. 16-bit and interlaced files are
 * refused by name rather than mis-decoded, because a logo that comes out as
 * noise is worse than one that comes out as a clear error in a test.
 */

export interface DecodedImage {
  width: number;
  height: number;
  /** Packed 8-bit RGB samples, row-major, alpha already flattened onto white. */
  rgb: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export class PngError extends Error {}

function readUint32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
  );
}

/** Channels per pixel for each PNG colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Reverses one scanline's filter.
 *
 * `raw` holds the filtered bytes of this line; `prior` the already-reconstructed
 * line above (zeroes for the first). `bpp` is the byte distance to the pixel to
 * the left. The five cases are exactly the PNG specification's.
 */
function unfilter(type: number, raw: Uint8Array, prior: Uint8Array, bpp: number): Uint8Array {
  const out = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i += 1) {
    const left = i >= bpp ? out[i - bpp] : 0;
    const up = prior[i] ?? 0;
    const upLeft = i >= bpp ? (prior[i - bpp] ?? 0) : 0;

    switch (type) {
      case 0:
        out[i] = raw[i];
        break;
      case 1:
        out[i] = (raw[i] + left) & 0xff;
        break;
      case 2:
        out[i] = (raw[i] + up) & 0xff;
        break;
      case 3:
        out[i] = (raw[i] + ((left + up) >> 1)) & 0xff;
        break;
      case 4: {
        // Paeth: pick whichever neighbour the gradient predicts.
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        out[i] = (raw[i] + predictor) & 0xff;
        break;
      }
      default:
        throw new PngError(`Unknown scanline filter ${type}`);
    }
  }

  return out;
}

export function decodePng(bytes: Uint8Array): DecodedImage {
  if (bytes.length < 8 || SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new PngError("Not a PNG");
  }

  let width = 0;
  let height = 0;
  let depth = 0;
  let colourType = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = readUint32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const body = bytes.subarray(at + 8, at + 8 + length);

    if (type === "IHDR") {
      width = readUint32(body, 0);
      height = readUint32(body, 4);
      depth = body[8];
      colourType = body[9];
      if (body[12] !== 0) throw new PngError("Interlaced PNGs are not supported");
    } else if (type === "PLTE") {
      palette = body.slice();
    } else if (type === "tRNS") {
      transparency = body.slice();
    } else if (type === "IDAT") {
      idat.push(body.slice());
    } else if (type === "IEND") {
      break;
    }

    at += 12 + length; // length + type + body + CRC
  }

  if (width <= 0 || height <= 0) throw new PngError("PNG has no dimensions");
  if (depth !== 8) throw new PngError(`Only 8-bit PNGs are supported, got ${depth}-bit`);
  const channels = CHANNELS[colourType];
  if (!channels) throw new PngError(`Unknown PNG colour type ${colourType}`);
  if (colourType === 3 && !palette) throw new PngError("Palette PNG has no PLTE chunk");
  if (idat.length === 0) throw new PngError("PNG has no image data");

  const compressed = Buffer.concat(idat.map((chunk) => Buffer.from(chunk)));
  const raw = Uint8Array.from(inflateSync(compressed));

  const bpp = channels; // 8-bit, so one byte per channel
  const stride = width * bpp;
  const expected = height * (stride + 1);
  if (raw.length < expected) {
    throw new PngError(`PNG data is short: ${raw.length} of ${expected} bytes`);
  }

  const rgb = new Uint8Array(width * height * 3);
  let prior: Uint8Array = new Uint8Array(stride);
  let source = 0;
  let target = 0;

  for (let row = 0; row < height; row += 1) {
    const filter = raw[source];
    source += 1;
    const line = unfilter(filter, raw.subarray(source, source + stride), prior, bpp);
    source += stride;
    prior = line;

    for (let column = 0; column < width; column += 1) {
      const at_ = column * bpp;
      let r = 0;
      let g = 0;
      let b = 0;
      let alpha = 255;

      switch (colourType) {
        case 0:
          r = g = b = line[at_];
          break;
        case 2:
          r = line[at_];
          g = line[at_ + 1];
          b = line[at_ + 2];
          break;
        case 3: {
          const entry = line[at_] * 3;
          r = palette![entry];
          g = palette![entry + 1];
          b = palette![entry + 2];
          alpha = transparency?.[line[at_]] ?? 255;
          break;
        }
        case 4:
          r = g = b = line[at_];
          alpha = line[at_ + 1];
          break;
        case 6:
          r = line[at_];
          g = line[at_ + 1];
          b = line[at_ + 2];
          alpha = line[at_ + 3];
          break;
      }

      // Composite onto white: the paper the form is printed on.
      if (alpha !== 255) {
        const a = alpha / 255;
        r = Math.round(r * a + 255 * (1 - a));
        g = Math.round(g * a + 255 * (1 - a));
        b = Math.round(b * a + 255 * (1 - a));
      }

      rgb[target] = r;
      rgb[target + 1] = g;
      rgb[target + 2] = b;
      target += 3;
    }
  }

  return { width, height, rgb };
}
