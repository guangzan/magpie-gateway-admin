import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // magpie 用的是系统 WebKit，不用迁就更老的浏览器
    target: "safari17",
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3478" },
  },
});
