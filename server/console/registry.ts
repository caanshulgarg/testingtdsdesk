// The console's modules. Adding a module: write server/console/modules/<name>.ts (export const module: Module) and
// add ONE line here. Action names must be unique across modules (the router refuses to start otherwise).
import { type Module } from "./core/types.ts";
import { module as me } from "./modules/me.ts";
import { module as dashboard } from "./modules/dashboard.ts";
import { module as firms } from "./modules/firms.ts";
import { module as companies } from "./modules/companies.ts";
import { module as users } from "./modules/users.ts";
import { module as audit } from "./modules/audit.ts";
import { module as admins } from "./modules/admins.ts";
import { module as settings } from "./modules/settings.ts";
import { module as keys } from "./modules/keys.ts";
import { module as announcements } from "./modules/announcements.ts";
import { module as flags } from "./modules/flags.ts";
import { module as support } from "./modules/support.ts";
import { module as health } from "./modules/health.ts";
import { module as exportsMod } from "./modules/exports.ts";
import { module as seeas } from "./modules/seeas.ts";

export const MODULES: Module[] = [
  me,
  dashboard,
  firms,
  companies,
  users,
  audit,
  admins,
  settings,
  keys,
  announcements,
  flags,
  support,
  health,
  exportsMod,
  seeas,
];
