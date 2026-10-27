// The console's modules, in menu order. Adding a module: make console/src/modules/<name>/index.jsx exporting
// `module = { id, label, icon, action, routes }` and add ONE line here. The menu shows a module when the admin's role
// may call its `action` (me.actions, from the server); its routes are matched against the hash path in order.
import { module as dashboard } from "./dashboard/index.jsx";
import { module as firms } from "./firms/index.jsx";
import { module as companies } from "./companies/index.jsx";
import { module as users } from "./users/index.jsx";
import { module as audit } from "./audit/index.jsx";
import { module as admins } from "./admins/index.jsx";
import { module as settings } from "./settings/index.jsx";
import { module as coupons } from "./coupons/index.jsx";
import { module as ai } from "./ai/index.jsx";
import { module as support } from "./support/index.jsx";
import { module as announcements } from "./announcements/index.jsx";
import { module as flags } from "./flags/index.jsx";
import { module as seeas } from "./seeas/index.jsx";
import { module as health } from "./health/index.jsx";
import { module as exportsMod } from "./exports/index.jsx";
import { module as keys } from "./keys/index.jsx";

export const MODULES = [
  dashboard,
  firms,
  companies,
  users,
  coupons,
  support,
  announcements,
  flags,
  seeas,
  health,
  audit,
  exportsMod,
  keys,
  admins,
  ai,
  settings,
];
