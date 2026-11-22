// The design proposal's mockups only (never part of the live app's build, which starts at app/index.html).
// Build:   cd app && npx vite build --config src/proposal/vite.config.js --outDir <somewhere outside the repo>
// Open:    <outDir>/index.html?s=home|client|new|search|bank|entry|tally|phone|phonebank|system|books-mode|books-coa|books-invoice|books-daybook|books-ledger|books-tb|books-audit|books-zoho|books-move [&theme=dark] [&state=empty|loading|new]
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react()],
  build: { emptyOutDir: true, sourcemap: false },
});
