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
import { module as subscriptions } from "./subscriptions/index.jsx";
import { module as credit } from "./credit/index.jsx";
import { module as plans } from "./plans/index.jsx";
import { module as prices } from "./prices/index.jsx";
import { module as billingRuns } from "./billing-runs/index.jsx";
import { module as coupons } from "./coupons/index.jsx";
import { module as ai } from "./ai/index.jsx";

export const MODULES = [
  dashboard,
  firms,
  companies,
  users,
  subscriptions,
  credit,
  plans,
  prices,
  billingRuns,
  coupons,
  audit,
  admins,
  ai,
  settings,
];
