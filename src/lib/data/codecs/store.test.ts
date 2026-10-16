/**
 * End to end through zarrita's own pipeline: the level-12 nodes of the
 * GRID4EARTH test store (metadata and first chunk, as written on S3) opened
 * from an in-memory store. `b04` is `hcc-sentinel2-pyramid`, `cell_ids` is
 * `numcodecs.delta` + `bytes` + `zstd`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";
import * as zarr from "zarrita";

import "./hcc";
import { setJxlWasmSource } from "./hcc/jxl";
import "./numcodecsDelta";

const FIXTURES = fileURLToPath(new URL("hcc/__fixtures__/", import.meta.url));
const STORE_DIR = join(FIXTURES, "store_L12");

/** A read-only zarrita store over the files of a directory. */
class DirectoryStore implements zarr.AsyncReadable {
  private files = new Map<string, Uint8Array>();

  constructor(root: string) {
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else {
          const key = "/" + relative(root, path).split("\\").join("/");
          this.files.set(key, new Uint8Array(readFileSync(path)));
        }
      }
    };
    walk(root);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    return this.files.get(key);
  }
}

beforeAll(() => {
  const require = createRequire(import.meta.url);
  const wasmPath = join(
    require.resolve("jxl-oxide-wasm/package.json"),
    "..",
    "jxl_oxide_wasm_bg.wasm"
  );
  setJxlWasmSource(readFileSync(wasmPath));
});

describe("level-12 nodes of the test store", () => {
  const root = zarr.root(new DirectoryStore(STORE_DIR));

  it("reads cell_ids through numcodecs.delta", async () => {
    const array = await zarr.open(root.resolve("cell_ids"), { kind: "array" });
    const chunk = await zarr.get(array);
    const expected = JSON.parse(
      readFileSync(join(FIXTURES, "store_L12_cell_ids.expected.json"), "utf8")
    ) as number[];
    expect(chunk.data).toBeInstanceOf(BigUint64Array);
    expect(Array.from(chunk.data as BigUint64Array, Number)).toEqual(expected);
  });

  it("reads b04 through hcc-sentinel2-pyramid", async () => {
    const array = await zarr.open(root.resolve("b04"), { kind: "array" });
    expect(array.dtype).toBe("float64");
    const chunk = await zarr.get(array);
    const bytes = readFileSync(join(FIXTURES, "real_L12_b04_0.expected.f64"));
    const expected = new Float64Array(new Uint8Array(bytes).buffer);
    expect(chunk.data).toBeInstanceOf(Float64Array);
    const data = chunk.data as Float64Array;
    expect(data.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      if (Number.isNaN(expected[i])) {
        expect(data[i]).toBeNaN();
      } else {
        expect(Math.abs(data[i] - expected[i])).toBeLessThanOrEqual(1e-6);
      }
    }
  });

  it("reads a slice of b04", async () => {
    const array = await zarr.open(root.resolve("b04"), { kind: "array" });
    const chunk = await zarr.get(array, [zarr.slice(100, 110)]);
    expect(chunk.shape).toEqual([10]);
  });
});
