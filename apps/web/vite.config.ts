import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // 部署在子路径时用 BASE_PATH 指定，例如 BASE_PATH=/camel/ npm run build。
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  // public/art 下的图路径固定，换图后浏览器可能还用缓存里的旧图：每次构建给美术地址带一个新的版本号。
  define: { __ART_VERSION__: JSON.stringify(Date.now().toString(36)) },
  server: {
    port: 5178,
    strictPort: true,
    proxy: {
      "/socket.io": { target: "http://localhost:3005", ws: true },
      "/health": "http://localhost:3005"
    }
  }
});
