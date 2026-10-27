// Settings (Owner only): a stub for the billing module. Platform defaults (trial credit, low-credit warning, grace
// days, ...) will live here, in a table its own migration (119-123 are reserved) makes; until then it reads nothing.
import { type Module } from "../core/types.ts";

export const module: Module = {
  name: "settings",
  actions: {
    "settings.get": { roles: ["owner"], kind: "read", run: async () => ({ ready: false, groups: [] }) },
  },
};
