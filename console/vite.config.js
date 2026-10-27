// FinCom Console (console/): its own small app, React 19 + Vite. `npm run build` -> dist/, served by the Worker
// fincom-console-staging (wrangler.jsonc). Strict CSP (_headers): no inline script or style, no data: fonts, so
// nothing is inlined (assetsInlineLimit 0) and Vite's module-preload helper is left out.
// The Supabase project the build talks to: CONSOLE_SUPABASE_URL / CONSOLE_SUPABASE_KEY (the public publishable key),
// defaulting to STAGING. build-site.sh checks the build names the staging project and no service key.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const STAGING_URL = "https://qbocskaiewaxqcvaunzc.supabase.co";
const STAGING_KEY = "sb_publishable_Q--gLdP6P-hU3gJDMHuKEA_fLTMJAxd";

export default defineConfig({
  plugins: [react()],
  define: {
    __SUPABASE_URL__: JSON.stringify(process.env.CONSOLE_SUPABASE_URL || STAGING_URL),
    __SUPABASE_KEY__: JSON.stringify(process.env.CONSOLE_SUPABASE_KEY || STAGING_KEY),
  },
  build: {
    outDir: process.env.CONSOLE_OUT || "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
    target: ["es2020", "safari14", "chrome87", "firefox78", "edge88"],
  },
});
