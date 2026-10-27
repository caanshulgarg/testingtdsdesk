// "me": who is signed in, their role and the actions it allows (the console draws its menus from this)
import { ALL, type Module } from "../core/types.ts";

export const module: Module = {
  name: "me",
  actions: {
    "me": {
      roles: ALL, kind: "read",
      run: async (ctx) => ({ user_id: ctx.caller.id, email: ctx.caller.email, role: ctx.caller.role, actions: ctx.allowed }),
    },
  },
};
