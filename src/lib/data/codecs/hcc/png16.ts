/**
 * Minimal PNG reader for the 16-bit grayscale images that jxl-oxide-wasm
 * produces: the WASM build exposes no raw pixel buffer, only `encodeToPng()`,
 * so the JPEG XL samples come back through a PNG container. Only what that
 * path produces is supported (colour type 0, bit depth 16, no interlace).
 */

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export interface Gray16Image {
  width: number;
  height: number;
  /** Row-major samples. */
  samples: Uint16Array;
}

function readChunks(png: Uint8Array): {
  width: number;
  height: number;
  idat: Uint8Array;
} {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (png[i] !== PNG_SIGNATURE[i]) {
      throw new Error("not a PNG stream");
    }
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  const idatParts: Uint8Array[] = [];
  let idatLength = 0;
  while (pos + 8 <= png.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
    const data = png.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      const bitDepth = png[pos + 16];
      const colourType = png[pos + 17];
      const interlace = png[pos + 20];
      if (bitDepth !== 16 || colourType !== 0 || interlace !== 0) {
        throw new Error(
          `unsupported PNG: bit depth ${bitDepth}, colour type ${colourType}, interlace ${interlace}`
        );
      }
    } else if (type === "IDAT") {
      idatParts.push(data);
      idatLength += data.length;
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length; // length, type, data, CRC
  }
  const idat = new Uint8Array(idatLength);
  let offset = 0;
  for (const part of idatParts) {
    idat.set(part, offset);
    offset += part.length;
  }
  return { width, height, idat };
}

/** zlib-wrapped deflate, as in PNG IDAT and in the codec's validity mask. */
export async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

/** Undo the per-scanline PNG filter in place; `bpp` bytes per pixel. */
function unfilter(raw: Uint8Array, rowBytes: number, bpp: number): Uint8Array {
  const height = raw.length / (rowBytes + 1);
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    const prev = dst - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const left = x >= bpp ? out[dst + x - bpp] : 0;
      const up = y > 0 ? out[prev + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[prev + x - bpp] : 0;
      let value = raw[src + x];
      switch (filter) {
        case 0:
          break;
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += (left + up) >> 1;
          break;
        case 4:
          value += paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`unknown PNG filter type ${filter}`);
      }
      out[dst + x] = value & 0xff;
    }
  }
  return out;
}

export async function decodePngGray16(png: Uint8Array): Promise<Gray16Image> {
  const { width, height, idat } = readChunks(png);
  const rowBytes = width * 2;
  const raw = await inflateZlib(idat);
  if (raw.length !== height * (rowBytes + 1)) {
    throw new Error(
      `PNG data has ${raw.length} bytes, expected ${height * (rowBytes + 1)}`
    );
  }
  const bytes = unfilter(raw, rowBytes, 2);
  const samples = new Uint16Array(width * height);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (bytes[2 * i] << 8) | bytes[2 * i + 1]; // big-endian
  }
  return { width, height, samples };
}
