import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The API (apps/api) runs on 8787 in development. Proxying keeps the UI same-origin.
      "/v1": "http://localhost:8787",
      "/health": "http://localhost:8787",
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
