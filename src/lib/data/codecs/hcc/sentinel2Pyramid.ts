/**
 * The two-layer `hcc-sentinel2-pyramid` coding of healpix-compress
 * (`hcc.compression.sentinel2_pyramid`), decoder side.
 *
 * A codestream holds, for one nested chunk of `4**delta` cells seen as a
 * `2**delta` square raster:
 *
 * 1. a 32-byte header `<4sBBBBfiIIII`: magic `HS2P`, version 1, `delta`, the
 *    predictor size `k`, flags (bit 0: a validity mask follows), the detail
 *    step `s` (float32, in digital numbers), the detail offset (int32) and the
 *    byte lengths of the four parts below;
 * 2. the predictor coefficients: 4 phases x (k*k + 1) float32, one filter per
 *    child phase over the k x k parent neighbourhood plus a bias;
 * 3. the **base**: the parent level (`2**(delta-1)` square) as digital numbers
 *    in a lossless JPEG XL codestream, DN 0 for parents without a valid child;
 * 4. the **detail**: `r16 = round((child - prediction) * Q / s) - offset` as
 *    uint16 in a lossless JPEG XL codestream;
 * 5. optionally the validity of each child, one bit per cell in raster order
 *    (most significant bit first), zlib-compressed.
 *
 * The decoder dequantises the base (`(DN + O) / Q`, no-data parents replaced
 * by the mean of the valid ones), predicts the children from the k x k
 * edge-padded neighbourhood, adds `(r16 + offset) * s / Q` and sets the
 * children of no-data parents, and the cells cleared in the mask, to `NaN`.
 */
import { decodeJxlGray16 } from "./jxl";
import { inflateZlib } from "./png16";
import {
  NODATA_DN,
  rowDepth,
  type FloatArray,
  type HccSentinel2Configuration,
  type Quantisation,
} from "./sentinel2";
import { rasterOffsets } from "./zorder";

const MAGIC = "HS2P";
const VERSION = 1;
const HEADER_BYTES = 32;
const FLAG_MASK = 1;
const PHASES = [
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 1],
] as const;

/** Configuration keys of `hcc-sentinel2-pyramid`; only `Q` and `O` matter for decoding. */
export interface HccSentinel2PyramidConfiguration
  extends HccSentinel2Configuration {
  relative_step?: number;
  min_step?: number;
  predictor_size?: number;
}

export interface PyramidStreamInfo {
  delta: number;
  predictorSize: number;
  /** Detail step, in digital numbers. */
  step: number;
  offset: number;
  hasMask: boolean;
  coefficientBytes: number;
  baseBytes: number;
  detailBytes: number;
  maskBytes: number;
}

/** Parse the codestream header (`hcc.compression.sentinel2_pyramid.stream_info`). */
export function streamInfo(stream: Uint8Array): PyramidStreamInfo {
  if (stream.length < HEADER_BYTES) {
    throw new Error("hcc-sentinel2-pyramid: truncated header");
  }
  const magic = String.fromCharCode(...stream.subarray(0, 4));
  const version = stream[4];
  if (magic !== MAGIC || version !== VERSION) {
    throw new Error(
      `hcc-sentinel2-pyramid: not a ${MAGIC} v${VERSION} codestream`
    );
  }
  const view = new DataView(stream.buffer, stream.byteOffset, HEADER_BYTES);
  return {
    delta: stream[5],
    predictorSize: stream[6],
    hasMask: (stream[7] & FLAG_MASK) !== 0,
    step: view.getFloat32(8, true),
    offset: view.getInt32(12, true),
    coefficientBytes: view.getUint32(16, true),
    baseBytes: view.getUint32(20, true),
    detailBytes: view.getUint32(24, true),
    maskBytes: view.getUint32(28, true),
  };
}

/**
 * Mean of an array the way numpy sums it (pairwise summation in blocks of
 * eight), so that the no-data fill of the base matches the reference decoder
 * as closely as possible.
 */
function numpyMean(values: Float64Array): number {
  return pairwiseSum(values, 0, values.length) / values.length;
}

function pairwiseSum(a: Float64Array, start: number, n: number): number {
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i++) {
      res += a[start + i];
    }
    return res;
  }
  if (n <= 128) {
    const r = new Float64Array(8);
    for (let j = 0; j < 8; j++) {
      r[j] = a[start + j];
    }
    let i = 8;
    for (; i < n - (n % 8); i += 8) {
      for (let j = 0; j < 8; j++) {
        r[j] += a[start + i + j];
      }
    }
    let res = r[0] + r[1] + (r[2] + r[3]) + (r[4] + r[5] + (r[6] + r[7]));
    for (; i < n; i++) {
      res += a[start + i];
    }
    return res;
  }
  const n2 = (n >> 1) - ((n >> 1) % 8);
  return pairwiseSum(a, start, n2) + pairwiseSum(a, start + n2, n - n2);
}

/** The base as the decoder sees it: dequantised, no-data parents filled by the mean. */
function decodedBase(
  baseDn: Uint16Array,
  { q, o }: Quantisation
): Float64Array {
  const base = new Float64Array(baseDn.length);
  let nValid = 0;
  for (let i = 0; i < baseDn.length; i++) {
    if (baseDn[i] !== NODATA_DN) {
      base[nValid++] = (baseDn[i] + o) / q;
    }
  }
  const fill = nValid > 0 ? numpyMean(base.subarray(0, nValid)) : 0.0;
  for (let i = 0; i < baseDn.length; i++) {
    base[i] = baseDn[i] !== NODATA_DN ? (baseDn[i] + o) / q : fill;
  }
  return base;
}

/**
 * Predict the `2h x 2h` children from the `h x h` base: for each child phase
 * `(di, dj)`, child `(2i + di, 2j + dj)` is the bias plus the dot product of
 * the filter with the k x k neighbourhood of parent `(i, j)`, edge-padded.
 */
function predict(
  base: Float64Array,
  h: number,
  coef: Float32Array,
  k: number
): Float64Array {
  const side = 2 * h;
  const pred = new Float64Array(side * side);
  const r = k >> 1;
  const nFeatures = k * k;
  for (let p = 0; p < PHASES.length; p++) {
    const [di, dj] = PHASES[p];
    const filter = coef.subarray(
      p * (nFeatures + 1),
      (p + 1) * (nFeatures + 1)
    );
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < h; j++) {
        let sum = 0;
        for (let a = 0; a < k; a++) {
          const row = Math.min(Math.max(i + a - r, 0), h - 1);
          for (let b = 0; b < k; b++) {
            const col = Math.min(Math.max(j + b - r, 0), h - 1);
            sum += base[row * h + col] * filter[a * k + b];
          }
        }
        sum += filter[nFeatures];
        pred[(2 * i + di) * side + 2 * j + dj] = sum;
      }
    }
  }
  return pred;
}

/** Validity of each child, from the base's no-data parents and the optional mask. */
function validity(
  baseDn: Uint16Array,
  h: number,
  mask: Uint8Array | null
): Uint8Array {
  const side = 2 * h;
  const valid = new Uint8Array(side * side);
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const c = row * side + col;
      let ok = baseDn[(row >> 1) * h + (col >> 1)] !== NODATA_DN;
      if (mask) {
        ok &&= ((mask[c >> 3] >> (7 - (c & 7))) & 1) === 1;
      }
      valid[c] = ok ? 1 : 0;
    }
  }
  return valid;
}

async function readLayers(stream: Uint8Array, info: PyramidStreamInfo) {
  const h = 2 ** (info.delta - 1);
  const k = info.predictorSize;
  let pos = HEADER_BYTES;
  const nCoef = 4 * (k * k + 1);
  if (info.coefficientBytes !== 4 * nCoef) {
    throw new Error(
      `hcc-sentinel2-pyramid: expected ${4 * nCoef} coefficient bytes, got ${info.coefficientBytes}`
    );
  }
  const coefView = new DataView(
    stream.buffer,
    stream.byteOffset + pos,
    4 * nCoef
  );
  const coef = new Float32Array(nCoef);
  for (let i = 0; i < nCoef; i++) {
    coef[i] = coefView.getFloat32(4 * i, true);
  }
  pos += info.coefficientBytes;
  const base = await decodeJxlGray16(
    stream.subarray(pos, pos + info.baseBytes)
  );
  pos += info.baseBytes;
  const detail = await decodeJxlGray16(
    stream.subarray(pos, pos + info.detailBytes)
  );
  pos += info.detailBytes;
  if (base.width !== h || base.height !== h) {
    throw new Error(
      `hcc-sentinel2-pyramid: base is ${base.width}x${base.height}, expected ${h}x${h}`
    );
  }
  if (detail.width !== 2 * h || detail.height !== 2 * h) {
    throw new Error(
      `hcc-sentinel2-pyramid: detail is ${detail.width}x${detail.height}, expected ${2 * h}x${2 * h}`
    );
  }
  const mask = info.hasMask
    ? await inflateZlib(stream.subarray(pos, pos + info.maskBytes))
    : null;
  return { h, k, coef, baseDn: base.samples, r16: detail.samples, mask };
}

/**
 * Decode one pyramid codestream into `out[offset : offset + 4**delta]`, in
 * nested order, `NaN` for no-data cells.
 */
export async function decodePyramidRow(
  stream: Uint8Array,
  quantisation: Quantisation,
  out: FloatArray,
  offset: number,
  size: number
): Promise<void> {
  const delta = rowDepth(size, "hcc-sentinel2-pyramid");
  const info = streamInfo(stream);
  if (info.delta !== delta) {
    throw new Error(
      `hcc-sentinel2-pyramid: codestream of 4^${info.delta} cells in a chunk of 4^${delta}`
    );
  }
  const { h, k, coef, baseDn, r16, mask } = await readLayers(stream, info);
  const pred = predict(decodedBase(baseDn, quantisation), h, coef, k);
  const valid = validity(baseDn, h, mask);
  const { q } = quantisation;
  const scale = info.step; // float32 step read as a double, as in Python
  const offsets = rasterOffsets(delta);
  for (let c = 0; c < size; c++) {
    const i = offsets[c];
    out[offset + c] = valid[i]
      ? pred[i] + ((r16[i] + info.offset) * scale) / q
      : NaN;
  }
}
