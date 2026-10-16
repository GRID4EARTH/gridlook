/**
 * The hcc Sentinel-2 codecs against test vectors produced by the reference
 * Python implementation (`scripts/make_hcc_fixtures.py`): the JPEG XL layers
 * bit for bit, the decoded reflectances within 1e-6 (1e-2 digital number),
 * `NaN` exactly where the reference has them.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";
import * as zarr from "zarrita";

import { decodeJxlGray16, setJxlWasmSource } from "./jxl";
import { streamInfo } from "./sentinel2Pyramid";

import { HCC_SENTINEL2, HCC_SENTINEL2_PYRAMID } from "./index";

const FIXTURES = fileURLToPath(new URL("__fixtures__/", import.meta.url));
const TOLERANCE = 1e-6;
const registry = zarr.registry;

interface Case {
  name: string;
  codec: string;
  configuration: Record<string, number>;
  shape: number[];
  data_type: "float32" | "float64";
  stream: string;
  expected: string;
  expected_dtype: "float32" | "float64";
  note: string;
  pyramid?: {
    delta: number;
    predictor_size: number;
    step: number;
    offset: number;
    has_mask: boolean;
    coefficient_bytes: number;
    base_bytes: number;
    detail_bytes: number;
    mask_bytes: number;
    base: string;
    base_shape: number[];
    detail: string;
    detail_shape: number[];
  };
}

const manifest = JSON.parse(
  readFileSync(join(FIXTURES, "manifest.json"), "utf8")
) as { cases: Case[] };

function readBytes(name: string): Uint8Array {
  const buffer = readFileSync(join(FIXTURES, name));
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function readExpected(testCase: Case): Float32Array | Float64Array {
  const bytes = readBytes(testCase.expected);
  // copy to an aligned buffer before viewing it as floats
  const copy = new Uint8Array(bytes);
  return testCase.expected_dtype === "float32"
    ? new Float32Array(copy.buffer)
    : new Float64Array(copy.buffer);
}

function readU16(name: string): Uint16Array {
  return new Uint16Array(new Uint8Array(readBytes(name)).buffer);
}

/** The chunk metadata zarrita passes to `fromConfig`. */
function meta(dataType: string, shape: number[]) {
  /* eslint-disable camelcase */
  return {
    data_type: dataType,
    shape,
    codecs: [],
    fill_value: null,
  } as unknown as Parameters<CodecEntry["fromConfig"]>[1];
  /* eslint-enable camelcase */
}

type CodecEntry = Awaited<
  ReturnType<NonNullable<ReturnType<typeof registry.get>>>
>;

async function codecFor(
  name: string,
  configuration: unknown,
  m: ReturnType<typeof meta>
) {
  const Codec = await registry.get(name)!();
  return Codec.fromConfig(configuration, m);
}

async function decodeWithRegistry(testCase: Case) {
  const codec = await codecFor(
    testCase.codec,
    testCase.configuration,
    meta(testCase.data_type, testCase.shape)
  );
  return (await codec.decode(readBytes(testCase.stream))) as zarr.Chunk<
    "float32" | "float64"
  >;
}

function compare(
  chunk: zarr.Chunk<"float32" | "float64">,
  expected: Float32Array | Float64Array
) {
  let maxError = 0;
  let nValid = 0;
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const v = chunk.data[i];
    if (Number.isNaN(e)) {
      if (!Number.isNaN(v)) {
        throw new Error(`cell ${i}: expected NaN, got ${v}`);
      }
      continue;
    }
    if (Number.isNaN(v)) {
      throw new Error(`cell ${i}: expected ${e}, got NaN`);
    }
    nValid++;
    maxError = Math.max(maxError, Math.abs(v - e));
  }
  return { maxError, nValid };
}

beforeAll(() => {
  // Node cannot fetch the Vite asset URL: hand the WASM bytes over
  const require = createRequire(import.meta.url);
  const wasmPath = join(
    require.resolve("jxl-oxide-wasm/package.json"),
    "..",
    "jxl_oxide_wasm_bg.wasm"
  );
  setJxlWasmSource(readFileSync(wasmPath));
});

describe("registration", () => {
  it("registers both codec names in the zarrita registry", () => {
    expect(registry.has(HCC_SENTINEL2_PYRAMID)).toBe(true);
    expect(registry.has(HCC_SENTINEL2)).toBe(true);
  });
});

describe("JPEG XL layers", () => {
  const layered = manifest.cases.filter((c) => c.pyramid);
  it.each(layered.map((c) => [c.name, c] as const))(
    "%s: base and detail rasters are bit-exact",
    async (_name, testCase) => {
      const stream = readBytes(testCase.stream);
      const info = streamInfo(stream);
      const p = testCase.pyramid!;
      expect(info.delta).toBe(p.delta);
      expect(info.predictorSize).toBe(p.predictor_size);
      expect(info.step).toBe(p.step);
      expect(info.offset).toBe(p.offset);
      expect(info.hasMask).toBe(p.has_mask);
      let pos = 32 + info.coefficientBytes;
      const base = await decodeJxlGray16(
        stream.subarray(pos, pos + info.baseBytes)
      );
      pos += info.baseBytes;
      const detail = await decodeJxlGray16(
        stream.subarray(pos, pos + info.detailBytes)
      );
      expect([base.height, base.width]).toEqual(p.base_shape);
      expect([detail.height, detail.width]).toEqual(p.detail_shape);
      expect(base.samples).toEqual(readU16(p.base));
      expect(detail.samples).toEqual(readU16(p.detail));
    }
  );
});

describe("decoded chunks", () => {
  it.each(manifest.cases.map((c) => [c.name, c] as const))(
    "%s matches the reference decoder",
    async (_name, testCase) => {
      const chunk = await decodeWithRegistry(testCase);
      const expected = readExpected(testCase);
      expect(chunk.shape).toEqual(testCase.shape);
      expect(chunk.data.length).toBe(expected.length);
      expect(chunk.data).toBeInstanceOf(
        testCase.data_type === "float32" ? Float32Array : Float64Array
      );
      const { maxError, nValid } = compare(chunk, expected);
      expect(maxError).toBeLessThanOrEqual(TOLERANCE);
      if (!testCase.name.includes("all_nan")) {
        expect(nValid).toBeGreaterThan(0);
      }
    }
  );
});

describe("invalid input", () => {
  it("rejects a chunk whose last axis is not a power of four", async () => {
    await expect(
      codecFor(HCC_SENTINEL2_PYRAMID, {}, meta("float64", [12]))
    ).rejects.toThrow(/power of four/);
  });

  it("rejects an integer array", async () => {
    await expect(
      codecFor(HCC_SENTINEL2, {}, meta("uint16", [16]))
    ).rejects.toThrow(/float32 or float64/);
  });

  it("rejects a codestream with the wrong magic", async () => {
    const testCase = manifest.cases.find((c) => c.name === "pyr_delta1")!;
    const stream = readBytes(testCase.stream).slice();
    stream[0] = 0;
    const codec = await codecFor(
      HCC_SENTINEL2_PYRAMID,
      testCase.configuration,
      meta("float64", [4])
    );
    await expect(codec.decode(stream)).rejects.toThrow(/HS2P/);
  });
});
