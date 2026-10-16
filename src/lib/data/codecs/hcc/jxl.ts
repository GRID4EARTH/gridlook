/**
 * Lossless 16-bit grayscale JPEG XL decoding through jxl-oxide-wasm.
 *
 * The WASM module is loaded on first use only, so datasets that do not use
 * the hcc codecs never pay for it. jxl-oxide-wasm renders to PNG (16-bit when
 * `forceSrgb` is off and the image is deeper than 8 bits), which
 * {@link decodePngGray16} unpacks; for lossless integer images the samples
 * come back unchanged.
 */
import wasmUrl from "jxl-oxide-wasm/module.wasm?url";

import { decodePngGray16, type Gray16Image } from "./png16";

type JxlModule = typeof import("jxl-oxide-wasm");
type InitInput = Parameters<JxlModule["default"]>[0];

let wasmSource: InitInput | undefined = undefined;
let modulePromise: Promise<JxlModule> | null = null;

/**
 * Where to load the WASM binary from. The default is the URL Vite gives the
 * module's `.wasm` file; tests running under Node pass the file's bytes.
 */
export function setJxlWasmSource(source: InitInput) {
  wasmSource = source;
  modulePromise = null;
}

export function loadJxl(): Promise<JxlModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const mod = await import("jxl-oxide-wasm");
      // eslint-disable-next-line camelcase
      await mod.default({ module_or_path: wasmSource ?? wasmUrl });
      return mod;
    })();
    modulePromise.catch(() => {
      modulePromise = null;
    });
  }
  return modulePromise;
}

/** Decode a lossless 16-bit grayscale JPEG XL codestream. */
export async function decodeJxlGray16(
  stream: Uint8Array
): Promise<Gray16Image> {
  const { JxlImage } = await loadJxl();
  const image = new JxlImage();
  let png: Uint8Array;
  try {
    // 16-bit output, whatever the browser's HDR support (Firefox is forced
    // to 8-bit sRGB by default)
    image.forceSrgb = false;
    image.feedBytes(stream);
    if (!image.tryInit()) {
      throw new Error("truncated JPEG XL codestream");
    }
    png = image.render().encodeToPng();
  } finally {
    image.free();
  }
  return decodePngGray16(png);
}
