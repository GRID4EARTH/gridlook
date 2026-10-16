/**
 * zarrita codecs for the healpix-compress Sentinel-2 serializers
 * `hcc-sentinel2-pyramid` (lossy: lossless parent level, predicted and
 * quantised children) and `hcc-sentinel2` (lossless digital numbers), both
 * JPEG XL based. Importing this module registers them; decoding only.
 *
 * Reference implementation: https://github.com/jmdelouis/healpix-compress
 * (`hcc/compression/sentinel2_pyramid.py`, `hcc/compression/sentinel2.py`).
 */
import { registry, type Chunk, type DataType } from "zarrita";

import {
  allocate,
  cStrides,
  decodeLosslessRow,
  decodeRows,
  isFloatDataType,
  readQuantisation,
  rowDepth,
  type FloatArray,
  type FloatDataType,
  type HccSentinel2Configuration,
  type Quantisation,
} from "./sentinel2";
import {
  decodePyramidRow,
  type HccSentinel2PyramidConfiguration,
} from "./sentinel2Pyramid";

export const HCC_SENTINEL2_PYRAMID = "hcc-sentinel2-pyramid";
export const HCC_SENTINEL2 = "hcc-sentinel2";

/**
 * What zarrita hands to `fromConfig` (its `ChunkMetadata`, not exported):
 * the array's data type and chunk shape are all the codecs need.
 */
export interface CodecMeta {
  data_type: DataType;
  shape: number[];
}

type RowDecoder = (
  stream: Uint8Array,
  quantisation: Quantisation,
  out: FloatArray,
  offset: number,
  size: number
) => Promise<void>;

/** What both codecs share: the chunk shape, the output dtype and the row container. */
abstract class HccSentinel2Base {
  readonly kind = "array_to_bytes";
  protected readonly shape: number[];
  protected readonly dataType: FloatDataType;
  protected readonly quantisation: Quantisation;

  constructor(
    name: string,
    configuration: HccSentinel2Configuration | undefined,
    meta: CodecMeta,
    protected readonly decodeRow: RowDecoder
  ) {
    if (!isFloatDataType(meta.data_type)) {
      throw new Error(
        `${name} stores reflectances as float32 or float64, got ${meta.data_type}`
      );
    }
    if (meta.shape.length === 0) {
      throw new Error(`${name}: expected a chunk with at least one axis`);
    }
    rowDepth(meta.shape[meta.shape.length - 1], name);
    this.shape = [...meta.shape];
    this.dataType = meta.data_type;
    this.quantisation = readQuantisation(configuration);
  }

  async decode(bytes: Uint8Array): Promise<Chunk<FloatDataType>> {
    const size = this.shape.reduce((a, b) => a * b, 1);
    const data = allocate(this.dataType, size);
    const rowSize = this.shape[this.shape.length - 1];
    await decodeRows(
      bytes,
      this.shape,
      (stream, out, offset) =>
        this.decodeRow(stream, this.quantisation, out, offset, rowSize),
      data
    );
    return { data, shape: this.shape, stride: cStrides(this.shape) };
  }

  encode(): never {
    throw new Error("the hcc Sentinel-2 codecs are decode-only in Gridlook");
  }
}

export class HccSentinel2PyramidCodec extends HccSentinel2Base {
  static fromConfig(
    configuration: unknown,
    meta: CodecMeta
  ): HccSentinel2PyramidCodec {
    return new HccSentinel2PyramidCodec(
      configuration as HccSentinel2PyramidConfiguration | undefined,
      meta
    );
  }

  constructor(
    configuration: HccSentinel2PyramidConfiguration | undefined,
    meta: CodecMeta
  ) {
    super(HCC_SENTINEL2_PYRAMID, configuration, meta, decodePyramidRow);
  }
}

export class HccSentinel2Codec extends HccSentinel2Base {
  static fromConfig(
    configuration: unknown,
    meta: CodecMeta
  ): HccSentinel2Codec {
    return new HccSentinel2Codec(
      configuration as HccSentinel2Configuration | undefined,
      meta
    );
  }

  constructor(
    configuration: HccSentinel2Configuration | undefined,
    meta: CodecMeta
  ) {
    super(HCC_SENTINEL2, configuration, meta, decodeLosslessRow);
  }
}

registry.set(HCC_SENTINEL2_PYRAMID, async () => HccSentinel2PyramidCodec);
registry.set(HCC_SENTINEL2, async () => HccSentinel2Codec);
