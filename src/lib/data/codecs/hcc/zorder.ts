/**
 * Morton (Z-order) index of a nested HEALPix chunk, as in
 * `hcc.compression.zorder` of healpix-compress: cell `c` of a chunk of
 * `4**delta` cells sits at row `x` (the even bits of `c`) and column `y` (the
 * odd bits of `c`) of a `2**delta` square raster.
 */

const cache = new Map<number, Uint32Array>();

/** Raster offset `x * side + y` of every cell of a chunk of `4**delta` cells. */
export function rasterOffsets(delta: number): Uint32Array {
  let offsets = cache.get(delta);
  if (offsets) {
    return offsets;
  }
  const size = 4 ** delta;
  const side = 2 ** delta;
  offsets = new Uint32Array(size);
  for (let code = 0; code < size; code++) {
    let x = 0;
    let y = 0;
    for (let bit = 0; bit < delta; bit++) {
      x |= ((code >>> (bit << 1)) & 1) << bit;
      y |= ((code >>> ((bit << 1) + 1)) & 1) << bit;
    }
    offsets[code] = x * side + y;
  }
  cache.set(delta, offsets);
  return offsets;
}

/** `delta` such that `size === 4**delta`, or -1 when `size` is not a power of four. */
export function chunkDepth(size: number): number {
  if (size < 1) {
    return -1;
  }
  const delta = Math.round(Math.log2(size) / 2);
  return 4 ** delta === size ? delta : -1;
}
