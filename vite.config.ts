import { fileURLToPath, URL } from "url";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import glsl from "vite-plugin-glsl";
import wasm from "vite-plugin-wasm";

// https://vitejs.dev/config/
export default defineConfig({
  // wasm() lets us import the @eopf-dggs/healpix-geo WebAssembly module.
  // The module initializes via top-level await, which the es2022 build target
  // (and Vite 8 / rolldown) supports natively — no top-level-await plugin needed.
  plugins: [vue(), glsl(), wasm()],
  build: {
    sourcemap: true,
    target: "es2022",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler",
      },
    },
  },
  base: "./",
});
