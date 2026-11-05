import { expect, it } from "vitest";
import * as zarr from "zarrita";

import {
  castDataVarToFloat32,
  decodeVariableDataAndGetBounds,
  getDefaultRange,
  getDefaultRangeFromAttributes,
  getFillValue,
  markZarrV2Array,
} from "@/lib/data/variableDecoding.ts";

const encoder = new TextEncoder();

function zarrV2Store(dtype: string, fillValue: number | null) {
  const zarray = {
    zarr_format: 2, // eslint-disable-line camelcase
    shape: [3],
    chunks: [3],
    dtype,
    compressor: null,
    fill_value: fillValue, // eslint-disable-line camelcase
    order: "C",
    filters: null,
  };
  return new Map([["/dn/.zarray", encoder.encode(JSON.stringify(zarray))]]);
}

function zarrV3Store(dataType: string, fillValue: number) {
  const zarrJson = {
    zarr_format: 3, // eslint-disable-line camelcase
    node_type: "array", // eslint-disable-line camelcase
    shape: [3],
    data_type: dataType, // eslint-disable-line camelcase
    // eslint-disable-next-line camelcase
    chunk_grid: {
      name: "regular",
      configuration: { chunk_shape: [3] }, // eslint-disable-line camelcase
    },
    chunk_key_encoding: { name: "default" }, // eslint-disable-line camelcase
    codecs: [{ name: "bytes", configuration: { endian: "little" } }],
    fill_value: fillValue, // eslint-disable-line camelcase
    attributes: {},
  };
  return new Map([["/dn/zarr.json", encoder.encode(JSON.stringify(zarrJson))]]);
}

async function openZarrV2Array(dtype: string, fillValue: number | null) {
  const store = zarrV2Store(dtype, fillValue);
  const array = (await zarr.open.v2(zarr.root(store).resolve("dn"), {
    kind: "array",
  })) as unknown as zarr.Array<zarr.DataType, zarr.AsyncReadable>;
  markZarrV2Array(array);
  return array;
}

it("converts signed and unsigned 64-bit arrays to renderable values", () => {
  expect(
    castDataVarToFloat32(new BigInt64Array([-42n, 0n, 4294967296n]))
  ).toEqual(new Float32Array([-42, 0, 4294967296]));
  expect(
    castDataVarToFloat32(new BigUint64Array([0n, 4294967296n, 2n ** 63n]))
  ).toEqual(new Float32Array([0, 4294967296, 2 ** 63]));
});

it("does not mask zeros when _FillValue is null", () => {
  // xarray writes `_FillValue: null` for "no fill value", e.g. on lon axes
  // starting at 0; masking 0 there opens a seam at the prime meridian.
  const longitude = {
    fillValue: null,
    attrs: { units: "degrees_east", _FillValue: null },
  } as unknown as zarr.Array<zarr.DataType, zarr.AsyncReadable>;
  const values = new Float32Array([0, 0.25, 359.75]);

  const { fillValue } = decodeVariableDataAndGetBounds(longitude, values);

  expect(fillValue).toBeNaN();
  expect(values).toEqual(new Float32Array([0, 0.25, 359.75]));
});

it("does not mask zeros when missing_value is null", () => {
  const precipitation = {
    fillValue: null,
    attrs: { units: "kg m-2 s-1", ["missing_value"]: null },
  } as unknown as zarr.Array<zarr.DataType, zarr.AsyncReadable>;
  const values = new Float32Array([0, 1e-5]);

  const { missingValue } = decodeVariableDataAndGetBounds(
    precipitation,
    values
  );

  expect(missingValue).toBeNaN();
  expect(values).toEqual(new Float32Array([0, 1e-5]));
});

it.each(["<u2", "<f4"])(
  "masks zeros when a Zarr v2 %s array has fill_value 0",
  async (dtype) => {
    const dn = await openZarrV2Array(dtype, 0);
    const values = new Float32Array([0, 1200, 0]);

    const { fillValue, min, max } = decodeVariableDataAndGetBounds(dn, values);

    expect(fillValue).toBe(0);
    expect(Array.from(values)).toEqual([NaN, 1200, NaN]);
    expect([min, max]).toEqual([1200, 1200]);
  }
);

it("masks zeros when a Zarr v2 int64 array has fill_value 0", async () => {
  const dn = await openZarrV2Array("<i8", 0);
  expect(dn.fillValue).toBe(0n);
  expect(getFillValue(dn)).toBe(0);
});

it("does not mask zeros when a Zarr v2 fill_value is null", async () => {
  const dn = await openZarrV2Array("<u2", null);
  const values = new Float32Array([0, 1200]);

  const { fillValue } = decodeVariableDataAndGetBounds(dn, values);

  expect(fillValue).toBeNaN();
  expect(values).toEqual(new Float32Array([0, 1200]));
});

it("does not mask zeros for the default Zarr v3 fill_value 0", async () => {
  // zarr-python writes fill_value 0 to every v3 array created without one.
  const store = zarrV3Store("uint16", 0);
  const dn = (await zarr.open.v3(zarr.root(store).resolve("dn"), {
    kind: "array",
  })) as unknown as zarr.Array<zarr.DataType, zarr.AsyncReadable>;
  const values = new Float32Array([0, 1200]);

  const { fillValue } = decodeVariableDataAndGetBounds(dn, values);

  expect(fillValue).toBeNaN();
  expect(values).toEqual(new Float32Array([0, 1200]));
});

it("masks zeros when a Zarr v3 array sets _FillValue 0", () => {
  const dn = {
    fillValue: 0,
    attrs: { _FillValue: 0 },
  } as unknown as zarr.Array<zarr.DataType, zarr.AsyncReadable>;
  const values = new Float32Array([0, 1200]);

  const { fillValue } = decodeVariableDataAndGetBounds(dn, values);

  expect(fillValue).toBe(0);
  expect(Array.from(values)).toEqual([NaN, 1200]);
});

/* eslint-disable camelcase -- CF attribute names are snake_case. */
it("takes the default colour range from actual_range as it is", () => {
  // CF: actual_range is in unpacked units, even when the data is packed.
  expect(
    getDefaultRangeFromAttributes({
      actual_range: [0, 0.3],
      scale_factor: 0.0001,
      add_offset: -0.1,
      valid_min: 1,
      valid_max: 65535,
    })
  ).toEqual({ low: 0, high: 0.3 });
});

it("does not use valid_range, valid_min or valid_max", () => {
  // They often hold the dtype limits, not a range worth looking at.
  expect(
    getDefaultRangeFromAttributes({ valid_range: [-32767, 32767] })
  ).toBeUndefined();
  expect(
    getDefaultRangeFromAttributes({
      valid_min: 1,
      valid_max: 65535,
      scale_factor: 0.0001,
    })
  ).toBeUndefined();
});

it("orders an actual_range given high to low", () => {
  expect(getDefaultRangeFromAttributes({ actual_range: [10, 0] })).toEqual({
    low: 0,
    high: 10,
  });
});

it("ignores empty or malformed range attributes", () => {
  expect(getDefaultRangeFromAttributes(undefined)).toBeUndefined();
  expect(getDefaultRangeFromAttributes({})).toBeUndefined();
  expect(getDefaultRangeFromAttributes({ actual_range: [1] })).toBeUndefined();
  expect(
    getDefaultRangeFromAttributes({ actual_range: [2, 2] })
  ).toBeUndefined();
  expect(
    getDefaultRangeFromAttributes({ actual_range: ["a", 1] })
  ).toBeUndefined();
});

it("prefers the index's default_range over the variable's attributes", () => {
  expect(
    getDefaultRange({
      default_range: { low: 0.05, high: 0.2 },
      attrs: { actual_range: [0, 0.3] },
    })
  ).toEqual({ low: 0.05, high: 0.2 });
  expect(getDefaultRange({ attrs: { actual_range: [0, 0.3] } })).toEqual({
    low: 0,
    high: 0.3,
  });
  expect(getDefaultRange({ attrs: { units: "K" } })).toBeUndefined();
  expect(getDefaultRange(undefined)).toBeUndefined();
});
