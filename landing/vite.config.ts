import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "ecies-geth": "ecies-geth/dist/lib/src/typescript/browser.js",
    },
  },
});
