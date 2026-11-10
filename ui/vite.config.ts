import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  // 管理页在服务根，通过相对路径加载 assets，magpie web 反代到服务根下的
  // 任意层级时也能用。
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // magpie 用的是系统 WebKit，不用迁就更老的浏览器
    target: "safari17",
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
      },
    },
  },
  server: {
    port: 5173,
    // 服务会校验 Host/Origin；开发代理要改成目标 Host，Origin 仍是 localhost。
    proxy: {
      "/api": { target: "http://127.0.0.1:3478", changeOrigin: true },
    },
  },
});
