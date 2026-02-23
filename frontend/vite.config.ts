import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws":  { target: "ws://localhost:8000", ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-query":    ["@tanstack/react-query", "zustand"],
          "vendor-ui":       ["@radix-ui/react-dialog", "@radix-ui/react-popover", "@radix-ui/react-tooltip",
                              "@radix-ui/react-tabs", "@radix-ui/react-select", "@radix-ui/react-scroll-area",
                              "@radix-ui/react-separator", "@radix-ui/react-slider"],
          "vendor-motion":   ["framer-motion"],
          "vendor-markdown": ["react-markdown"],
          "vendor-dropzone": ["react-dropzone"],
        },
      },
    },
  },
});
