/**
 * zarrita codec for `numcodecs.delta`, the Zarr v3 wrapper of numcodecs'
 * `Delta` filter: each element is stored as the difference to the previous
 * one (the first as is). Decoding is the cumulative sum. The GRID4EARTH
 * HEALPix stores use it on their `cell_ids` coordinates (uint64), so it is
 * needed before any of their arrays can be placed on the globe. Decode-only.
 */
import { registry, type Chunk, type DataType } from "zarrita";

interface DeltaConfiguration {
  /** numpy dtype of the array, e.g. `<u8`; the output dtype defaults to it. */
  dtype?: string;
  astype?: string;
}

interface CodecMeta {
  data_type: DataType;
  shape: number[];
}

type IntegerArray =
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | BigInt64Array
  | BigUint64Array;

function isBigIntArray(
  data: ArrayLike<number> | ArrayLike<bigint>
): data is BigInt64Array | BigUint64Array {
  return data instanceof BigInt64Array || data instanceof BigUint64Array;
}

export class NumcodecsDeltaCodec {
  readonly kind = "array_to_array";

  static fromConfig(
    configuration: unknown,
    meta: CodecMeta
  ): NumcodecsDeltaCodec {
    return new NumcodecsDeltaCodec(
      configuration as DeltaConfiguration | undefined,
      meta
    );
  }

  constructor(configuration: DeltaConfiguration | undefined, meta: CodecMeta) {
    if (
      configuration?.astype !== undefined &&
      configuration.astype !== configuration.dtype
    ) {
      throw new Error(
        "numcodecs.delta: a storage dtype different from the array dtype is not supported"
      );
    }
    if (
      meta.data_type.startsWith("float") ||
      meta.data_type === "bool" ||
      meta.data_type === "string"
    ) {
      throw new Error(
        `numcodecs.delta: only integer arrays are supported, got ${meta.data_type}`
      );
    }
  }

  decode(chunk: Chunk<DataType>): Chunk<DataType> {
    const data = chunk.data as IntegerArray;
    if (isBigIntArray(data)) {
      for (let i = 1; i < data.length; i++) {
        data[i] = BigInt.asUintN(64, data[i - 1] + data[i]);
      }
    } else {
      for (let i = 1; i < data.length; i++) {
        data[i] = data[i - 1] + data[i]; // the typed array wraps as numpy does
      }
    }
    return chunk;
  }

  encode(): never {
    throw new Error("numcodecs.delta is decode-only in Gridlook");
  }
}

registry.set("numcodecs.delta", async () => NumcodecsDeltaCodec);
