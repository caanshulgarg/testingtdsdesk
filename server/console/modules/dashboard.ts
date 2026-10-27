// Dashboard: counts and sums only (console_dashboard, migration 118)
import { ALL, type Module } from "../core/types.ts";

export const module: Module = {
  name: "dashboard",
  actions: {
    "dashboard": { roles: ALL, kind: "read", run: async (ctx) => await ctx.deps.rpc("console_dashboard", {}) },
  },
};
