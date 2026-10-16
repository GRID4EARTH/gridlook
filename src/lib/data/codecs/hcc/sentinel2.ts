/**
 * The lossless `hcc-sentinel2` coding of healpix-compress
 * (`hcc.compression.sentinel2`): reflectances `rho` are the Sentinel-2
 * digital numbers `DN = round(Q * rho - O)` with `DN = 0` for no-data, the
 * chunk is scattered into a square raster by Morton de-interleaving and
 * stored as a lossless JPEG XL codestream. Decoding gives
 * `rho = (DN + O) / Q`, `NaN` where `DN = 0`.
 *
 * This module also holds what both hcc codecs share: the configuration keys,
 * the chunk container of chunks with leading axes, and the output array.
 */
import { decodeJxlGray16 } from "./jxl";
import { chunkDepth, rasterOffsets } from "./zorder";

/** Digital number reserved for no-data cells. */
export const NODATA_DN = 0;
/** `QUANTIFICATION_VALUE` of Sentinel-2 L1C and L2A products. */
export const DEFAULT_QUANTIFICATION_VALUE = 10000.0;
/** `RADIO_ADD_OFFSET` / `BOA_ADD_OFFSET` since processing baseline 04.00. */
export const DEFAULT_ADD_OFFSET = -1000.0;

/** Configuration keys the two codecs share, as written in `zarr.json`. */
export interface HccSentinel2Configuration {
  quantification_value?: number;
  add_offset?: number;
  effort?: number;
}

export interface Quantisation {
  /** `Q` of the product metadata. */
  q: number;
  /** `O` of the product metadata. */
  o: number;
}

export function readQuantisation(
  configuration: HccSentinel2Configuration | undefined
): Quantisation {
  const q = configuration?.quantification_value ?? DEFAULT_QUANTIFICATION_VALUE;
  const o = configuration?.add_offset ?? DEFAULT_ADD_OFFSET;
  if (!(q > 0) || !Number.isFinite(o)) {
    throw new Error(
      `hcc-sentinel2: invalid quantification_value ${q} / add_offset ${o}`
    );
  }
  return { q, o };
}

export type FloatDataType = "float32" | "float64";
export type FloatArray = Float32Array | Float64Array;

export function isFloatDataType(dataType: string): dataType is FloatDataType {
  return dataType === "float32" || dataType === "float64";
}

export function allocate(dataType: FloatDataType, size: number): FloatArray {
  return dataType === "float32"
    ? new Float32Array(size)
    : new Float64Array(size);
}

/** Row-major strides of a C-ordered array of `shape`. */
export function cStrides(shape: number[]): number[] {
  const stride = new Array<number>(shape.length);
  let step = 1;
  for (let i = shape.length - 1; i >= 0; i--) {
    stride[i] = step;
    step *= shape[i];
  }
  return stride;
}

/**
 * Decode a chunk written row by row along its last axis
 * (`hcc.compression.sentinel2.decode_rows`): a 1-D chunk is one codestream;
 * a chunk with leading axes is the little-endian uint64 byte length of each
 * row's codestream, rows in C order, followed by the codestreams.
 */
export async function decodeRows(
  data: Uint8Array,
  shape: number[],
  decodeRow: (
    stream: Uint8Array,
    out: FloatArray,
    offset: number
  ) => Promise<void>,
  out: FloatArray
): Promise<void> {
  const rowSize = shape[shape.length - 1];
  if (shape.length === 1) {
    await decodeRow(data, out, 0);
    return;
  }
  const nRows = out.length / rowSize;
  const header = 8 * nRows;
  if (data.length < header) {
    throw new Error(
      `hcc-sentinel2: truncated chunk, ${data.length} bytes for ${nRows} rows`
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, header);
  let pos = header;
  for (let row = 0; row < nRows; row++) {
    const length = Number(view.getBigUint64(8 * row, true));
    if (pos + length > data.length) {
      throw new Error("hcc-sentinel2: corrupt chunk, rows exceed the data");
    }
    await decodeRow(data.subarray(pos, pos + length), out, row * rowSize);
    pos += length;
  }
  if (pos !== data.length) {
    throw new Error(
      "hcc-sentinel2: corrupt chunk, trailing bytes after the rows"
    );
  }
}

/** The depth of a row of `size` cells, or an error for sizes that are not powers of four. */
export function rowDepth(size: number, codec: string): number {
  const delta = chunkDepth(size);
  if (delta < 0) {
    throw new Error(
      `${codec}: the last chunk axis must be a power of four (one nested parent cell), got ${size}`
    );
  }
  return delta;
}

/**
 * Decode one lossless codestream into `out[offset : offset + 4**delta]`, in
 * nested order.
 */
export async function decodeLosslessRow(
  stream: Uint8Array,
  { q, o }: Quantisation,
  out: FloatArray,
  offset: number,
  size: number
): Promise<void> {
  const delta = rowDepth(size, "hcc-sentinel2");
  const { width, height, samples } = await decodeJxlGray16(stream);
  if (width !== height || width * height !== size) {
    throw new Error(
      `hcc-sentinel2: expected a ${2 ** delta} square raster, got ${width}x${height}`
    );
  }
  const offsets = rasterOffsets(delta);
  for (let c = 0; c < size; c++) {
    const dn = samples[offsets[c]];
    out[offset + c] = dn === NODATA_DN ? NaN : (dn + o) / q;
  }
}
